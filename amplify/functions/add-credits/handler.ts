import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Table names from environment (set in backend.ts)
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;

export const handler: Schema["addCreditsLambda"]["functionHandler"] = async (event) => {
  console.log("Add Credits request:", JSON.stringify(event, null, 2));
  
  const { userId, credits, amountPaid, currency, tierId } = event.arguments;

  if (!userId || !credits || credits <= 0) {
    throw new Error("Missing required arguments: userId and credits (must be positive)");
  }

  const identity = event.identity;
  if (!identity) {
    throw new Error("Unauthorized: must be logged in");
  }

  // Check if user is admin or the owner
  const isAdmin = "groups" in identity && identity.groups?.includes("ADMINS");
  const isOwner = "username" in identity && identity.username === userId;

  if (!isAdmin && !isOwner) {
    throw new Error("Unauthorized: can only add credits to your own account (or be an admin)");
  }

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
    const currentCredits = existingRecord?.credits || 0;
    const newCredits = currentCredits + credits;

    if (existingRecord) {
      // Update existing record using the id (partition key)
      console.log("Updating existing UserCredits record:", existingRecord.id);
      await docClient.send(
        new UpdateCommand({
          TableName: USER_CREDITS_TABLE,
          Key: { id: existingRecord.id },
          UpdateExpression: 'SET credits = :credits, lastUpdated = :now',
          ExpressionAttributeValues: {
            ':credits': newCredits,
            ':now': new Date().toISOString(),
          },
        })
      );
      console.log("Successfully updated UserCredits record");
    } else {
      // Create new record
      const newId = randomUUID();
      const newRecord = {
        id: newId,
        userId,
        credits: newCredits,
        lastUpdated: new Date().toISOString(),
      };
      console.log("Creating new UserCredits record:", JSON.stringify(newRecord, null, 2));
      await docClient.send(
        new PutCommand({
          TableName: USER_CREDITS_TABLE,
          Item: newRecord,
        })
      );
      console.log("Successfully created UserCredits record with id:", newId);
      
      // Verify the record was created by querying it back
      const verifyResponse = await docClient.send(
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
      console.log("Verification query result:", JSON.stringify(verifyResponse.Items, null, 2));
    }

    // Create transaction record
    await docClient.send(
      new PutCommand({
        TableName: CREDIT_TRANSACTIONS_TABLE,
        Item: {
          id: randomUUID(),
          userId,
          amount: credits,
          pricePaid: amountPaid || null,
          currency: currency || 'USD',
          tier: tierId || null,
          transactionType: 'purchase',
          description: tierId ? `Purchased ${tierId} tier` : 'Credits added',
          createdAt: new Date().toISOString(),
        },
      })
    );

    console.log(`Successfully added ${credits} credits to user ${userId}. New balance: ${newCredits}`);

    // Query the record one more time to verify it exists and return the full record
    const finalQueryResponse = await docClient.send(
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
    
    const finalRecord = finalQueryResponse.Items?.[0];
    console.log("Final record after update:", JSON.stringify(finalRecord, null, 2));

    return JSON.stringify({
      success: true,
      userId,
      creditsAdded: credits,
      newBalance: newCredits,
      recordId: finalRecord?.id,
      recordExists: !!finalRecord,
    });
  } catch (error) {
    console.error("Error adding credits:", error);
    throw new Error(`Failed to add credits: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

