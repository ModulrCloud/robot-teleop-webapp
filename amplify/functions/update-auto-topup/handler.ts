import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;

export const handler: Schema["updateAutoTopUpLambda"]["functionHandler"] = async (event) => {
  console.log("Update Auto Top-Up request:", JSON.stringify(event, null, 2));
  
  const { autoTopUpEnabled, autoTopUpThreshold, autoTopUpTier } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  const userId = identity.username;

  try {
    // Query UserCredits by userId using the secondary index
    const queryResponse = await docClient.send(
      new QueryCommand({
        TableName: USER_CREDITS_TABLE,
        IndexName: 'userIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Limit: 1,
      })
    );

    const existingRecord = queryResponse.Items?.[0];

    if (existingRecord) {
      // Update existing record - only auto top-up fields, NOT credits
      await docClient.send(
        new UpdateCommand({
          TableName: USER_CREDITS_TABLE,
          Key: { id: existingRecord.id },
          UpdateExpression: 'SET autoTopUpEnabled = :enabled, autoTopUpThreshold = :threshold, autoTopUpTier = :tier, lastUpdated = :now',
          ExpressionAttributeValues: {
            ':enabled': autoTopUpEnabled ?? false,
            ':threshold': autoTopUpThreshold ?? null,
            ':tier': autoTopUpTier ?? null,
            ':now': new Date().toISOString(),
          },
        })
      );
      console.log("Updated auto top-up settings for user:", userId);
    } else {
      // Create new record with default credits of 0
      await docClient.send(
        new PutCommand({
          TableName: USER_CREDITS_TABLE,
          Item: {
            id: randomUUID(),
            userId,
            credits: 0,
            autoTopUpEnabled: autoTopUpEnabled ?? false,
            autoTopUpThreshold: autoTopUpThreshold ?? null,
            autoTopUpTier: autoTopUpTier ?? null,
            lastUpdated: new Date().toISOString(),
          },
        })
      );
      console.log("Created new UserCredits record with auto top-up settings for user:", userId);
    }

    return JSON.stringify({
      success: true,
      userId,
      autoTopUpEnabled: autoTopUpEnabled ?? false,
      autoTopUpThreshold: autoTopUpThreshold ?? null,
      autoTopUpTier: autoTopUpTier ?? null,
    });
  } catch (error) {
    console.error("Error updating auto top-up settings:", error);
    throw new Error(`Failed to update auto top-up settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

