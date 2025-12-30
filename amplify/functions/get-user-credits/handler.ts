import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;

export const handler: Schema["getUserCreditsLambda"]["functionHandler"] = async (event) => {
  console.log("Get User Credits request:", JSON.stringify(event, null, 2));
  
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  const userId = identity.username;

  try {
    // Query UserCredits by userId using the secondary index (same as addCredits Lambda)
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

    console.log("Query response:", JSON.stringify(queryResponse.Items, null, 2));
    
    const userCredits = queryResponse.Items?.[0] || null;

    return JSON.stringify({
      success: true,
      userCredits: userCredits ? {
        id: userCredits.id,
        userId: userCredits.userId,
        credits: userCredits.credits || 0,
        autoTopUpEnabled: userCredits.autoTopUpEnabled || false,
        autoTopUpThreshold: userCredits.autoTopUpThreshold,
        autoTopUpTier: userCredits.autoTopUpTier,
        lastUpdated: userCredits.lastUpdated,
      } : null,
    });
  } catch (error) {
    console.error("Error getting user credits:", error);
    throw new Error(`Failed to get user credits: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

