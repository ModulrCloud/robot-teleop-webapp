import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, AdminUserGlobalSignOutCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const ddbClient = new DynamoDBClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_INVALIDATION_TABLE = process.env.USER_INVALIDATION_TABLE!;

/**
 * Performs a complete sign-out by invalidating ALL tokens (including refresh tokens)
 * for the current user across ALL devices using Cognito's AdminUserGlobalSignOut.
 * 
 * This forces the user to re-authenticate via Google SSO on their next login attempt.
 * 
 * @param event - GraphQL mutation event (no arguments needed, uses authenticated user)
 * @returns Success or error response
 */
export const handler: Schema["globalSignOutLambda"]["functionHandler"] = async (event) => {
  const identity = event.identity;
  
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  const username = identity.username;

  try {
    // Call Cognito's AdminUserGlobalSignOut to invalidate ALL tokens for this user
    // This includes refresh tokens, so the user will need to re-authenticate
    await cognito.send(
      new AdminUserGlobalSignOutCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );

    // Store invalidation timestamp to reject ALL tokens issued before this time
    // This catches tokens from other devices that weren't explicitly blacklisted
    const invalidatedAt = Date.now(); // Current timestamp in milliseconds
    const ttlSeconds = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days from now (longer than token lifetime)
    
    await ddbClient.send(
      new PutItemCommand({
        TableName: USER_INVALIDATION_TABLE,
        Item: {
          userId: { S: username },
          invalidatedAt: { N: String(invalidatedAt) }, // Timestamp when user signed out
          ttl: { N: String(ttlSeconds) }, // Auto-delete after 7 days (tokens expire in 4 hours anyway)
        },
      })
    );


    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: "All sessions signed out successfully",
        username,
      }),
    };
  } catch (error) {
    console.error("Error performing global sign-out:", error);
    
    // If the user is already signed out or doesn't exist, that's okay
    if (error instanceof Error && (
      error.name === 'UserNotFoundException' ||
      error.name === 'NotAuthorizedException'
    )) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: "User already signed out or not found",
          username,
        }),
      };
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to perform global sign-out",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
