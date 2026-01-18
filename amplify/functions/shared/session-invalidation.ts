import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const ddbClient = new DynamoDBClient({});

const USER_INVALIDATION_TABLE = process.env.USER_INVALIDATION_TABLE!;

/**
 * Checks if a user's session has been invalidated (global sign-out).
 * Returns the invalidation timestamp if user was invalidated, null otherwise.
 * 
 * This catches tokens from other devices that weren't explicitly blacklisted.
 * If a token was issued (iat) before the invalidation timestamp, it's invalid.
 */
export async function getUserInvalidationTimestamp(userId: string): Promise<number | null> {
    console.log('[SESSION_INVALIDATION] Checking user invalidation timestamp', {
        userId,
        tableName: USER_INVALIDATION_TABLE,
        hasTableName: !!USER_INVALIDATION_TABLE,
    });

    if (!USER_INVALIDATION_TABLE) {
        // If table name not set, fail open (allow request) for availability
        console.error('[SESSION_INVALIDATION] ❌ USER_INVALIDATION_TABLE not set - skipping invalidation check', {
            userId,
            reason: 'Environment variable USER_INVALIDATION_TABLE is not set',
        });
        return null;
    }

    try {
        const result = await ddbClient.send(
            new GetItemCommand({
                TableName: USER_INVALIDATION_TABLE,
                Key: { userId: { S: userId } },
            })
        );
        
        console.log('[SESSION_INVALIDATION] DynamoDB GetItem result', {
            userId,
            hasItem: !!result?.Item,
            itemKeys: result?.Item ? Object.keys(result.Item) : [],
            hasInvalidatedAt: !!result?.Item?.invalidatedAt,
        });
        
        if (result?.Item?.invalidatedAt?.N) {
            // Return the timestamp when user signed out (in milliseconds)
            const invalidatedAt = parseInt(result.Item.invalidatedAt.N, 10);
            console.log('[SESSION_INVALIDATION] Found invalidation record', {
                userId,
                invalidatedAt,
                invalidatedAtDate: new Date(invalidatedAt).toISOString(),
            });
            return invalidatedAt;
        }
        
        console.log('[SESSION_INVALIDATION] No invalidation record found', { userId });
        return null; // No invalidation record
    } catch (error) {
        // If we can't check invalidation, log but don't block (fail open for availability)
        console.error('[SESSION_INVALIDATION] ❌ Failed to check user invalidation timestamp', { 
            userId, 
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            tableName: USER_INVALIDATION_TABLE,
        });
        return null; // Fail open - allow if we can't check
    }
}

/**
 * Checks if a token should be rejected based on session invalidation.
 * 
 * @param userId - User ID (username from Cognito)
 * @param tokenIat - Token "issued at" time in seconds (from JWT payload)
 * @returns true if token should be rejected (token was issued before global sign-out)
 */
export async function isUserSessionInvalidated(
    userId: string,
    tokenIat: number | undefined
): Promise<boolean> {
    console.log('[SESSION_INVALIDATION] Checking session invalidation', {
        userId,
        hasTokenIat: tokenIat !== undefined,
        tokenIat,
    });

    // If we don't have token iat, we can't check - fail open (allow request)
    if (!tokenIat) {
        console.warn('[SESSION_INVALIDATION] ⚠️ Cannot check session invalidation - token iat not available', { 
            userId,
            reason: 'Token iat not available - cannot compare against invalidation timestamp'
        });
        return false; // Fail open - allow if we can't check
    }

    const invalidatedAt = await getUserInvalidationTimestamp(userId);
    
    console.log('[SESSION_INVALIDATION] Retrieved invalidation timestamp', {
        userId,
        invalidatedAt,
        hasInvalidationRecord: invalidatedAt !== null,
    });
    
    if (!invalidatedAt) {
        // No invalidation record - token is valid
        console.log('[SESSION_INVALIDATION] ✅ No invalidation record - token is valid', { userId });
        return false;
    }

    // Token's iat is in seconds, invalidatedAt is in milliseconds
    // Convert invalidatedAt to seconds for comparison
    const invalidatedAtSeconds = Math.floor(invalidatedAt / 1000);
    
    console.log('[SESSION_INVALIDATION] Comparing token iat vs invalidation timestamp', {
        userId,
        tokenIat,
        invalidatedAtMs: invalidatedAt,
        invalidatedAtSeconds,
        tokenIssuedBeforeSignOut: tokenIat < invalidatedAtSeconds,
    });
    
    // Token is invalid if it was issued before the invalidation timestamp
    if (tokenIat < invalidatedAtSeconds) {
        console.error('[SESSION_INVALIDATION] ❌ Token issued before user global sign-out - REJECTING', {
            userId,
            tokenIat,
            invalidatedAtSeconds,
            timeDifferenceSeconds: invalidatedAtSeconds - tokenIat,
        });
        return true; // Token should be rejected
    }

    // Token was issued after invalidation timestamp - it's valid
    console.log('[SESSION_INVALIDATION] ✅ Token issued after invalidation - token is valid', {
        userId,
        tokenIat,
        invalidatedAtSeconds,
        timeDifferenceSeconds: tokenIat - invalidatedAtSeconds,
    });
    return false;
}

/**
 * Attempts to extract token iat from event (for GraphQL Lambda functions).
 * 
 * Note: GraphQL Lambda functions don't always have direct access to the raw token.
 * This is a best-effort attempt to extract iat from the token if available.
 * 
 * @param event - GraphQL Lambda event (may contain request headers or identity)
 * @returns token iat in seconds, or undefined if not available
 */
export function extractTokenIatFromEvent(event: {
  request?: { headers?: Record<string, string> };
  headers?: Record<string, string>;
}): number | undefined {
    console.log('[SESSION_INVALIDATION] Attempting to extract token iat from event', {
        hasEvent: !!event,
        hasRequest: !!event?.request,
        hasHeaders: !!event?.request?.headers,
        eventKeys: event ? Object.keys(event) : [],
    });

    // Try to extract from Authorization header (if available)
    const authHeader = event.request?.headers?.Authorization || 
                      event.request?.headers?.authorization ||
                      event.headers?.Authorization ||
                      event.headers?.authorization;

    console.log('[SESSION_INVALIDATION] Authorization header check', {
        hasAuthHeader: !!authHeader,
        authHeaderPrefix: authHeader ? authHeader.substring(0, 20) : undefined,
        startsWithBearer: authHeader?.startsWith('Bearer '),
    });

    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.substring(7); // Remove "Bearer " prefix
            // Decode JWT token (without verification - we just want iat)
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            const iat = payload.iat as number | undefined;
            
            console.log('[SESSION_INVALIDATION] ✅ Successfully extracted token iat', {
                iat,
                iatDate: iat ? new Date(iat * 1000).toISOString() : undefined,
                hasIat: iat !== undefined,
            });
            
            return iat;
        } catch (error) {
            // If we can't extract iat, that's okay - we'll fail open
            console.warn('[SESSION_INVALIDATION] ⚠️ Failed to extract token iat from Authorization header', {
                error: error instanceof Error ? error.message : String(error),
                errorName: error instanceof Error ? error.name : undefined,
            });
        }
    } else {
        console.warn('[SESSION_INVALIDATION] ⚠️ Authorization header not found or doesn\'t start with Bearer', {
            hasAuthHeader: !!authHeader,
        });
    }

    // If we can't extract iat, return undefined
    // Callers should handle this by failing open (allowing request)
    console.log('[SESSION_INVALIDATION] ⚠️ Cannot extract token iat - failing open', {
        reason: 'Authorization header not available or token cannot be decoded',
    });
    return undefined;
}
