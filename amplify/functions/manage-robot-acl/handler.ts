import { DynamoDBClient, UpdateItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

/**
 * Manages the Access Control List (ACL) for a robot.
 * Allows robot owners to add/remove users from the ACL, or delete the ACL entirely (making robot open access).
 * Only the robot owner (Partner who created it) or admins can manage ACLs.
 */
export const handler: Schema["manageRobotACLLambda"]["functionHandler"] = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const { robotId, userEmail, action } = event.arguments;
  // action: 'add', 'remove', or 'delete' (delete removes the entire ACL, making robot open access)

  const identity = event.identity;
  if (!identity || !("username" in identity) || !("groups" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

  // Check if user is an admin
  const isAdminUser = (identity.groups || []).some(
    (g) => g.toUpperCase() === 'ADMINS' || g.toUpperCase() === 'ADMIN'
  );

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
  const currentAllowedUsers = robotResult.Item.allowedUsers?.SS || [];

  if (!robotPartnerId) {
    throw new Error("Robot has no partnerId - data corruption detected");
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
      throw new Error("No Partner found for this user. Only Partners can manage robot ACLs.");
    }

    const requesterPartnerId = partnerItem.id.S;

    // Verify ownership
    if (requesterPartnerId !== robotPartnerId) {
      throw new Error(`Forbidden: You are not the owner of robot "${robotName}". Only the robot owner or admins can manage ACLs.`);
    }
  }

  // Handle different actions
  if (action === 'delete') {
    // Remove the ACL entirely (set to null) - makes robot open access
    await ddbClient.send(
      new UpdateItemCommand({
        TableName: robotTableName,
        Key: { id: { S: robotId } },
        UpdateExpression: 'REMOVE allowedUsers',
      })
    );

    console.log(`✅ Successfully removed ACL for robot "${robotName}" (${robotId}) - robot is now open access`);
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `ACL removed for robot "${robotName}". Robot is now open access.`,
        robotId: robotId,
        allowedUsers: null,
      }),
    };
  }

  // For 'add' or 'remove', userEmail is required
  if (!userEmail) {
    throw new Error("userEmail is required for 'add' or 'remove' actions");
  }

  const normalizedEmail = userEmail.toLowerCase().trim();

  if (action === 'add') {
    // Add user to ACL (if not already present)
    if (currentAllowedUsers.includes(normalizedEmail)) {
      return {
        statusCode: 409,
        body: JSON.stringify({ 
          message: `User ${normalizedEmail} is already in the ACL`,
          robotId: robotId,
          allowedUsers: currentAllowedUsers,
        }),
      };
    }

    const updatedUsers = [...currentAllowedUsers, normalizedEmail];

    await ddbClient.send(
      new UpdateItemCommand({
        TableName: robotTableName,
        Key: { id: { S: robotId } },
        UpdateExpression: 'SET allowedUsers = :users',
        ExpressionAttributeValues: {
          ':users': { SS: updatedUsers },
        },
      })
    );

    console.log(`✅ Successfully added ${normalizedEmail} to ACL for robot "${robotName}" (${robotId})`);
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `User ${normalizedEmail} added to ACL for robot "${robotName}"`,
        robotId: robotId,
        allowedUsers: updatedUsers,
      }),
    };
  }

  if (action === 'remove') {
    // Remove user from ACL
    if (!currentAllowedUsers.includes(normalizedEmail)) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          message: `User ${normalizedEmail} is not in the ACL`,
          robotId: robotId,
          allowedUsers: currentAllowedUsers,
        }),
      };
    }

    const updatedUsers = currentAllowedUsers.filter(u => u !== normalizedEmail);

    // If removing the last user, we could either keep an empty array or delete the ACL
    // For now, we'll keep an empty array (restricted but no users = no one can access except owner/admins/delegates)
    // Alternatively, if empty, we could delete the ACL to make it open access
    // Let's delete the ACL if it becomes empty (makes more sense - empty ACL = open access)
    if (updatedUsers.length === 0) {
      await ddbClient.send(
        new UpdateItemCommand({
          TableName: robotTableName,
          Key: { id: { S: robotId } },
          UpdateExpression: 'REMOVE allowedUsers',
        })
      );

      console.log(`✅ Removed last user from ACL for robot "${robotName}" (${robotId}) - ACL deleted, robot is now open access`);
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: `Removed ${normalizedEmail} from ACL. ACL is now empty and has been deleted - robot "${robotName}" is now open access.`,
          robotId: robotId,
          allowedUsers: null,
        }),
      };
    }

    await ddbClient.send(
      new UpdateItemCommand({
        TableName: robotTableName,
        Key: { id: { S: robotId } },
        UpdateExpression: 'SET allowedUsers = :users',
        ExpressionAttributeValues: {
          ':users': { SS: updatedUsers },
        },
      })
    );

    console.log(`✅ Successfully removed ${normalizedEmail} from ACL for robot "${robotName}" (${robotId})`);
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `User ${normalizedEmail} removed from ACL for robot "${robotName}"`,
        robotId: robotId,
        allowedUsers: updatedUsers,
      }),
    };
  }

  throw new Error(`Invalid action: ${action}. Must be 'add', 'remove', or 'delete'`);
};

