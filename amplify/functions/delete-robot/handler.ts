import { DynamoDBClient, DeleteItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Schema } from '../../data/resource';
import { createAuditLog } from '../shared/audit-log';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const cognito = new CognitoIdentityProviderClient({});

/**
 * Deletes a robot from DynamoDB.
 * Only the robot owner (Partner who created it) or admins can delete robots.
 */
export const handler: Schema["deleteRobotLambda"]["functionHandler"] = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const { robotId } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity) || !("groups" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;
  const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE;
  const USER_POOL_ID = process.env.USER_POOL_ID;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

  // Check if user is an admin (groups or email domain)
  const adminGroups = identity.groups || [];
  const isInAdminGroup = adminGroups.some(
    (g) => g.toUpperCase() === 'ADMINS' || g.toUpperCase() === 'ADMIN'
  );
  
  // Also check email domain for Modulr employees
  let userEmail: string | undefined;
  let isModulrEmployee = false;
  if (USER_POOL_ID && identity.username) {
    try {
      const userResponse = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: identity.username,
        })
      );
      userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
      isModulrEmployee = !!(userEmail && 
        typeof userEmail === 'string' && 
        userEmail.toLowerCase().trim().endsWith('@modulr.cloud'));
    } catch (error) {
      console.warn("Could not fetch email from Cognito:", error);
    }
  }
  
  const isAdminUser = isInAdminGroup || isModulrEmployee;

  // Get the robot to verify ownership
  const robotResult = await ddbClient.send(
    new GetItemCommand({
      TableName: robotTableName,
      Key: { id: { S: robotId } },
    })
  );

  if (!robotResult.Item) {
    throw new Error(`Robot with ID ${robotId} not found`);
  }

  const robotPartnerId = robotResult.Item.partnerId?.S;
  const robotName = robotResult.Item.name?.S || 'Unknown';
  const robotModel = robotResult.Item.model?.S || null;

  if (!robotPartnerId) {
    throw new Error("Robot has no partnerId - data corruption detected");
  }
  
  // Get partner info for audit log (if admin is deleting)
  let partnerCognitoUsername: string | undefined;
  if (isAdminUser && partnerTableName) {
    try {
      // Get partner record by id (primary key)
      const partnerResult = await ddbClient.send(
        new GetItemCommand({
          TableName: partnerTableName,
          Key: { id: { S: robotPartnerId } },
        })
      );
      partnerCognitoUsername = partnerResult.Item?.cognitoUsername?.S;
    } catch (error) {
      console.warn("Could not fetch partner info for audit log:", error);
    }
  }

  // If not admin, verify the requester is the robot owner
  if (!isAdminUser) {
    // Lookup the Partner record for this user
    const partnerQuery = await ddbClient.send(
      new QueryCommand({
        TableName: partnerTableName,
        IndexName: "cognitoUsernameIndex",
        KeyConditionExpression: "cognitoUsername = :username",
        ExpressionAttributeValues: {
          ":username": { S: identity.username },
        },
        Limit: 1,
      })
    );

    const partnerItem = partnerQuery.Items?.[0];
    if (!partnerItem || !partnerItem.id?.S) {
      throw new Error("No Partner found for this user. Only Partners can delete robots.");
    }

    const requesterPartnerId = partnerItem.id.S;

    // Verify ownership
    if (requesterPartnerId !== robotPartnerId) {
      throw new Error(`Forbidden: You are not the owner of robot "${robotName}". Only the robot owner or admins can delete robots.`);
    }
  }

  // Delete the robot
  await ddbClient.send(
    new DeleteItemCommand({
      TableName: robotTableName,
      Key: { id: { S: robotId } },
    })
  );

  console.log(`✅ Successfully deleted robot "${robotName}" (${robotId})`);

  // Create audit log entry if admin deleted the robot
  if (isAdminUser) {
    const adminUserId = identity.username;
    await createAuditLog(docClient, {
      action: 'DELETE_ROBOT',
      adminUserId,
      targetUserId: partnerCognitoUsername || undefined,
      reason: `Admin deleted robot "${robotName}"`,
      metadata: {
        robotId,
        robotName,
        robotModel,
        partnerId: robotPartnerId,
      },
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ 
      message: `Robot "${robotName}" deleted successfully`,
      robotId: robotId 
    }),
  };
};

