import { DynamoDBClient, DeleteItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

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

  return {
    statusCode: 200,
    body: JSON.stringify({ 
      message: `Robot "${robotName}" deleted successfully`,
      robotId: robotId 
    }),
  };
};

