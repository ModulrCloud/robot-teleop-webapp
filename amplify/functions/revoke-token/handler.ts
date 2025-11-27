import type { Schema } from "../../data/resource";
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { createHash } from 'crypto';

const ddbClient = new DynamoDBClient({});
const REVOKED_TOKENS_TABLE = process.env.REVOKED_TOKENS_TABLE!;

/**
 * Revokes a JWT token by adding it to the blacklist.
 * The token will be rejected by the signaling server until it expires.
 * 
 * @param event - GraphQL mutation event with token to revoke
 * @returns Success or error response
 */
export const handler: Schema["revokeTokenLambda"]["functionHandler"] = async (event) => {
  console.log("Revoke token request:", event);
  
  const { token } = event.arguments;
  const identity = event.identity;
  
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  if (!token || typeof token !== 'string') {
    return { statusCode: 400, body: "Token is required" };
  }

  try {
    // Create a hash of the token to use as the key (for privacy and size)
    // We use SHA-256 to create a deterministic ID from the token
    const tokenHash = createHash('sha256').update(token).digest('hex');
    
    // Extract expiration from token (if present) to set TTL
    // Tokens typically expire in 1 hour, so we'll set TTL to match
    let ttl: number;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadB64 = parts[1];
        const pad = '='.repeat((4 - (payloadB64.length % 4)) % 4);
        const json = Buffer.from(payloadB64 + pad, 'base64url').toString('utf-8');
        const payload = JSON.parse(json);
        // Set TTL to token expiration time (Unix timestamp in seconds)
        // Add 1 hour buffer to ensure it stays in blacklist until token expires
        ttl = (payload.exp || Math.floor(Date.now() / 1000) + 3600) + 3600;
      } else {
        // Fallback: 2 hours from now
        ttl = Math.floor(Date.now() / 1000) + 7200;
      }
    } catch {
      // If we can't parse token, set TTL to 2 hours from now
      ttl = Math.floor(Date.now() / 1000) + 7200;
    }

    // Store revoked token in blacklist
    await ddbClient.send(
      new PutItemCommand({
        TableName: REVOKED_TOKENS_TABLE,
        Item: {
          tokenId: { S: tokenHash },
          userId: { S: identity.username },
          revokedAt: { N: String(Date.now()) },
          ttl: { N: String(ttl) }, // TTL for automatic cleanup
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Token revoked successfully" }),
    };
  } catch (error) {
    console.error("Error revoking token:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to revoke token" }),
    };
  }
};

