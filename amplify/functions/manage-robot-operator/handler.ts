import { DynamoDBClient, PutItemCommand, DeleteItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from "uuid";
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

/**
 * Adds or removes a robot operator (delegation).
 * Only the robot owner (from ROBOT_PRESENCE_TABLE) or admins can manage operators.
 */
export const handler: Schema["manageRobotOperatorLambda"]["functionHandler"] = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const { robotId, operatorUserId, operatorUsername, action } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const robotOperatorTableName = process.env.ROBOT_OPERATOR_TABLE!;
  const robotPresenceTableName = process.env.ROBOT_PRESENCE_TABLE!;
  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;

  if (!robotOperatorTableName || !robotPresenceTableName || !robotTableName || !partnerTableName) {
    throw new Error("Required environment variables not set");
  }

  const requesterUsername = identity.username; // Cognito username
  const requesterSub = (identity as any).sub || requesterUsername; // Use sub if available, fallback to username
  
  // The ownerUserId in ROBOT_PRESENCE_TABLE is the Cognito sub (user ID), not username
  // We need to verify the requester is the owner by checking their sub
  // For now, we'll use username as a fallback, but ideally we'd get sub from identity
  // Note: In production, you might need to look up the sub from username via Cognito

  // Verify requester is robot owner or admin
  // First, check if robot is registered and get owner
  const robotPresence = await ddbClient.send(
    new GetItemCommand({
      TableName: robotPresenceTableName,
      Key: { robotId: { S: robotId } },
    })
  );

  const ownerUserId = robotPresence.Item?.ownerUserId?.S;
  if (!ownerUserId) {
    throw new Error("Robot not found or not registered");
  }

  // Check if requester is owner
  // Note: ownerUserId is the Cognito sub, but identity.username is the username
  // This is a limitation - ideally we'd have identity.sub available
  // For now, we'll allow if the username matches (this may need adjustment based on your setup)
  // TODO: Get sub from Cognito or ensure identity includes sub field
  const isOwner = ownerUserId === requesterSub || ownerUserId === requesterUsername;
  
  // TODO: Check if user is admin via Cognito groups from identity
  if (!isOwner) {
    throw new Error("Only robot owner or admin can manage operators");
  }

  if (action === 'add') {
    // Check if operator already exists
    const existing = await ddbClient.send(
      new QueryCommand({
        TableName: robotOperatorTableName,
        IndexName: "robotIdIndex",
        KeyConditionExpression: "robotId = :robotId",
        FilterExpression: "operatorUserId = :operatorUserId",
        ExpressionAttributeValues: {
          ":robotId": { S: robotId },
          ":operatorUserId": { S: operatorUserId },
        },
        Limit: 1,
      })
    );

    if (existing.Items && existing.Items.length > 0) {
      return {
        statusCode: 409,
        body: JSON.stringify({ message: "Operator already assigned to this robot" }),
      };
    }

    // Add operator
    const id = uuidv4();
    await ddbClient.send(
      new PutItemCommand({
        TableName: robotOperatorTableName,
        Item: {
          id: { S: id },
          robotId: { S: robotId },
          operatorUserId: { S: operatorUserId },
          operatorUsername: { S: operatorUsername || operatorUserId },
          assignedBy: { S: requesterSub },
          assignedAt: { S: new Date().toISOString() },
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Operator added successfully", id }),
    };
  } else if (action === 'remove') {
    // Find and remove operator
    const existing = await ddbClient.send(
      new QueryCommand({
        TableName: robotOperatorTableName,
        IndexName: "robotIdIndex",
        KeyConditionExpression: "robotId = :robotId",
        FilterExpression: "operatorUserId = :operatorUserId",
        ExpressionAttributeValues: {
          ":robotId": { S: robotId },
          ":operatorUserId": { S: operatorUserId },
        },
      })
    );

    if (!existing.Items || existing.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Operator not found for this robot" }),
      };
    }

    // Delete all matching operators (should only be one, but handle multiple)
    for (const item of existing.Items) {
      if (item.id?.S) {
        await ddbClient.send(
          new DeleteItemCommand({
            TableName: robotOperatorTableName,
            Key: { id: { S: item.id.S } },
          })
        );
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Operator removed successfully" }),
    };
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid action. Must be 'add' or 'remove'" }),
    };
  }
};

