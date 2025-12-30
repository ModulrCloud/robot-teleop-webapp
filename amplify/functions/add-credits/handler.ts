import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

// Table names from environment (set in backend.ts)
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["addCreditsLambda"]["functionHandler"] = async (event) => {
  console.log("Add Credits request:", JSON.stringify(event, null, 2));
  
  const { userId, credits, amountPaid, currency, tierId, description } = event.arguments;

  if (!userId || credits === undefined || credits === null || credits === 0) {
    throw new Error("Missing required arguments: userId and credits (must be non-zero)");
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  // Get user email for domain-based access check
  // In GraphQL Lambda resolvers, email is typically not in identity directly
  // Always fetch from Cognito using the username to ensure we have the email
  let userEmail: string | undefined;
  
  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    console.log("Fetched email from Cognito:", userEmail, "for username:", identity.username);
  } catch (error) {
    console.error("Could not fetch email from Cognito:", error);
    // If we can't get the email, we can't verify domain access, so deny
    throw new Error("Unauthorized: could not verify user email");
  }
  
  if (!userEmail) {
    console.error("No email found for user:", identity.username);
    throw new Error("Unauthorized: user email not found");
  }

  // Check if user is admin (ADMINS group or @modulr.cloud email)
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  
  // Check if user is a Modulr employee (@modulr.cloud domain)
  const isModulrEmployee = userEmail && 
    typeof userEmail === 'string' && 
    userEmail.toLowerCase().trim().endsWith('@modulr.cloud');
  
  const isAdmin = isInAdminGroup || isModulrEmployee;
  const isOwner = identity.username === userId;

  console.log("Access check:", {
    username: identity.username,
    userEmail,
    isInAdminGroup,
    isModulrEmployee,
    isAdmin,
    isOwner,
    credits,
  });

  // Only admins can deduct credits (negative values)
  if (credits < 0 && !isAdmin) {
    throw new Error("Unauthorized: only admins can deduct credits");
  }

  if (!isAdmin && !isOwner) {
    throw new Error("Unauthorized: can only adjust credits to your own account (or be an admin)");
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

    // Prevent negative balance
    if (newCredits < 0) {
      throw new Error(`Insufficient credits. Current balance: ${currentCredits}, attempted deduction: ${Math.abs(credits)}`);
    }

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
    const transactionType = credits > 0 ? 'purchase' : 'deduction';
    const defaultDescription = credits > 0 
      ? (tierId ? `Purchased ${tierId} tier` : 'Credits added')
      : 'Credits removed';
    
    await docClient.send(
      new PutCommand({
        TableName: CREDIT_TRANSACTIONS_TABLE,
        Item: {
          id: randomUUID(),
          userId,
          amount: Math.abs(credits), // Store absolute value
          pricePaid: amountPaid || null,
          currency: currency || 'USD',
          tier: tierId || null,
          transactionType: transactionType,
          description: description || defaultDescription,
          createdAt: new Date().toISOString(),
        },
      })
    );

    console.log(`Successfully ${credits > 0 ? 'added' : 'deducted'} ${Math.abs(credits)} credits ${credits > 0 ? 'to' : 'from'} user ${userId}. New balance: ${newCredits}`);

    // Create audit log entry if admin performed this action
    if (isAdmin && ADMIN_AUDIT_TABLE) {
      try {
        const adminUsername = "username" in identity ? identity.username : '';
        await docClient.send(
          new PutCommand({
            TableName: ADMIN_AUDIT_TABLE,
            Item: {
              id: randomUUID(),
              action: 'ADJUST_CREDITS',
              adminUserId: adminUsername,
              targetUserId: userId,
              reason: description || (credits > 0 ? 'Credits added by admin' : 'Credits removed by admin'),
              timestamp: new Date().toISOString(),
              metadata: {
                creditsAmount: credits,
                oldBalance: currentCredits,
                newBalance: newCredits,
                transactionType: credits > 0 ? 'addition' : 'removal',
              },
            },
          })
        );
        console.log(`Audit log entry created for credit adjustment by ${adminUsername}`);
      } catch (auditError) {
        // Don't fail the credit adjustment if audit logging fails, but log it
        console.error("Failed to create audit log entry:", auditError);
      }
    }

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

