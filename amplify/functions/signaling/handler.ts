import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
    DynamoDBClient,
    PutItemCommand,
    DeleteItemCommand,
    GetItemCommand,
    QueryCommand,
    ScanCommand,
    UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand as DocQueryCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const CONN_TABLE = process.env.CONN_TABLE!;
const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const REVOKED_TOKENS_TABLE = process.env.REVOKED_TOKENS_TABLE!;
const ROBOT_OPERATOR_TABLE = process.env.ROBOT_OPERATOR_TABLE!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME; // For session lock enforcement
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE;
const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE;
const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT!; // HTTPS management API
const USER_POOL_ID = process.env.USER_POOL_ID!;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Default platform markup (30%) if not set
const DEFAULT_PLATFORM_MARKUP_PERCENT = 30;

const db = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(db); // For UserCredits and PlatformSettings queries
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT});

// Cognito JWKS URL - public keys for verifying JWT signatures
const JWKS_URL = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`;
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

// ---------------------------------
// Types
// ---------------------------------

type LegacyMessageType = 'register' | 'offer' | 'answer' | 'ice-candidate' | 'takeover' | 'candidate' | 'monitor' | 'ping' | 'pong';
type ProtocolMessageType = 'signalling.offer' | 'signalling.answer' | 'signalling.ice_candidate' | 'signalling.connected' | 'signalling.disconnected' | 'signalling.capabilities' | 'signalling.error' | 'agent.ping' | 'agent.pong';
type MessageType = LegacyMessageType | ProtocolMessageType;
type Target = 'robot' | 'client';

// ---------------------------------
// MESSAGE FORMAT DOCUMENTATION
// ---------------------------------
// 
// IMPORTANT: Outbound message format was changed to match Modulr agent expectations.
// 
// Expected format (what we now send):
//   { type, to, from, sdp?, candidate? }
// 
// Previous format (what we used to send):
//   { type, robotId, from, payload: { sdp?, candidate? } }
// 
// This change ensures compatibility with:
// 1. Browser code (useWebRTC.ts) which expects msg.sdp and msg.candidate at top level
// 2. Modulr agent which expects { type, from, to, sdp, candidate } format
// 
// HISTORY:
// - Original format (Mike's implementation): { type, from, to, sdp, candidate } at top level
// - normalizeMessage() was added (commit 44633e5) to accept BOTH formats for incoming messages:
//   * Top-level sdp/candidate (Mike's format) - folded into payload internally
//   * Payload-wrapped format - kept as-is
// - Browser code (useWebRTC.ts) has ALWAYS sent/expected top-level format (never changed)
// - Server was sending payload-wrapped format, creating a mismatch
// - This change fixes the outbound format to match what browser/agent expect
// 
// See handleSignal() function around line 689 for the implementation and revert instructions.
// 
// ---------------------------------

type Claims = {
    sub?: string;
    groups?: string[];
    aud?: string;
    email?: string;
    'cognito:username'?: string;
};

type InboundMessage = Partial<{
    type: MessageType;
    robotId: string;
    target: Target;
    clientConnectionId: string;
    payload: Record<string, unknown>;
}>;

// Raw wire shape (browser or robot could send anythign so we normalize here)
type RawMessage = any;

// ---------------------------------
// Helpers
// ---------------------------------

const nowMs = () => Date.now();

/**
 * Checks if a token is in the revocation blacklist.
 * Returns true if token is revoked, false otherwise.
 */
async function isTokenRevoked(token: string): Promise<boolean> {
    try {
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const result = await db.send(
            new GetItemCommand({
                TableName: REVOKED_TOKENS_TABLE,
                Key: { tokenId: { S: tokenHash } },
            })
        );
        // Token is revoked if it exists in blacklist
        // Handle case where result might be undefined or Item might be undefined
        return !!(result && result.Item);
    } catch (error) {
        // If we can't check blacklist, log error but don't block (fail open for availability)
        console.warn('Failed to check token blacklist', error);
        return false; // Fail open - allow token if we can't check blacklist
    }
}

/**
 * Verifies and decodes a Cognito JWT token.
 * Validates signature, expiration, issuer, and audience.
 * Also checks if token has been revoked.
 * Returns null if token is invalid, expired, or revoked.
 */
async function verifyCognitoJWT(token: string | null | undefined): Promise<Claims | null> {
    if (!token) return null;
    
    // First check if token is revoked (before expensive signature verification)
    const revoked = await isTokenRevoked(token);
    if (revoked) {
        console.warn('Token is revoked', { hasToken: !!token });
        return null;
    }
    
    try {
        // Verify the JWT signature and decode the payload
        const { payload } = await jwtVerify(token, JWKS, {
            issuer: `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}`,
            // Cognito ID tokens use the client ID as audience
            // We'll be lenient here since we don't know the exact client ID
            // The signature verification is the most important part
        });

        // Check expiration (jwtVerify already does this, but we're explicit)
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            console.warn('Token expired', { exp: payload.exp, now });
            return null;
        }

        // Extract claims
        return {
            sub: payload.sub as string | undefined,
            groups: (payload['cognito:groups'] as string[] | undefined) ?? [],
            aud: payload.aud as string | undefined,
            email: payload.email as string | undefined,
            'cognito:username': payload['cognito:username'] as string | undefined,
        };
    } catch (error) {
        // Log verification failures for security monitoring
        console.warn('JWT verification failed', {
            error: error instanceof Error ? error.message : String(error),
            hasToken: !!token,
        });
        return null;
    }
}

/**
 * Extracts and normalizes the message type from a raw message.
 * Supports both legacy format (offer, answer, candidate) and new protocol (signalling.offer, etc.)
 */
function extractMessageType(raw: RawMessage): MessageType | undefined {
  if (typeof raw.type !== 'string') return undefined;
  
  const t = raw.type.toLowerCase();
  
  // New protocol format (v0.0)
  if (t === 'signalling.offer') return 'signalling.offer';
  if (t === 'signalling.answer') return 'signalling.answer';
  if (t === 'signalling.ice_candidate') return 'signalling.ice_candidate';
  if (t === 'signalling.connected') return 'signalling.connected';
  if (t === 'signalling.disconnected') return 'signalling.disconnected';
  if (t === 'signalling.capabilities') return 'signalling.capabilities';
  if (t === 'signalling.error') return 'signalling.error';
  if (t === 'agent.ping') return 'agent.ping';
  if (t === 'agent.pong') return 'agent.pong';
  
  // Legacy format
  if (t === 'candidate') return 'ice-candidate';
  if (t === 'offer') return 'offer';
  if (t === 'answer') return 'answer';
  if (t === 'register') return 'register';
  if (t === 'takeover') return 'takeover';
  if (t === 'ice-candidate') return 'ice-candidate';
  if (t === 'monitor') return 'monitor';
  if (t === 'ping') return 'ping';
  if (t === 'pong') return 'pong';
  
  return undefined;
}

/**
 * Extracts the robotId from a raw message.
 * Supports both legacy and new protocol formats.
 */
function extractRobotId(raw: RawMessage, type: MessageType | undefined): string | undefined {
  // Preferred: explicit 'robotId' field
  if (typeof raw.robotId === 'string' && raw.robotId.trim().length > 0) {
    return raw.robotId.trim();
  }

  // New protocol format: connectionId in payload is the robotId
  if (type?.startsWith('signalling.') && raw.payload?.connectionId) {
    return String(raw.payload.connectionId).trim();
  }

  // Registration messages always come from robots
  if (type === 'register') {
    if (typeof raw.from === 'string' && raw.from.trim().length > 0) {
      return raw.from.trim();
    }
    return undefined;
  }

  // For legacy WebRTC signaling messages
  const legacyTypes = ['offer', 'answer', 'candidate', 'ice-candidate'];
  if (type && legacyTypes.includes(type)) {
    const toField = typeof raw.to === 'string' ? raw.to.trim() : '';
    const fromField = typeof raw.from === 'string' ? raw.from.trim() : '';
    
    if (toField.startsWith('robot-')) return toField;
    if (fromField.startsWith('robot-')) return fromField;
    if (toField.length > 0) return toField;
    if (fromField.length > 0) return fromField;
  }

  return undefined;
}

/**
 * Extracts and combines payload data from a raw message.
 * Supports both legacy top-level fields and new protocol payload format.
 */
function extractPayload(raw: RawMessage): Record<string, unknown> | undefined {
  let payload: Record<string, unknown> | undefined;
  
  // Start with explicit payload object if present (new protocol format)
  if (raw.payload && typeof raw.payload === 'object') {
    payload = { ...raw.payload };
  }

  // Fold in top-level 'sdp' field (legacy format)
  if (raw.sdp) {
    payload = payload ?? {};
    payload.sdp = raw.sdp;
  }

  // Fold in top-level 'candidate' field (legacy format)
  if (raw.candidate) {
    payload = payload ?? {};
    payload.candidate = raw.candidate;
  }

  return payload;
}

/**
 * Extracts the target direction from a raw message.
 * Target indicates whether message is intended for 'robot' or 'client'.
 */
function extractTarget(raw: RawMessage): Target | undefined {
  if (typeof raw.target === 'string') {
    return raw.target.toLowerCase() as Target;
  }
  return undefined;
}

/**
 * Extracts the client connection ID from a raw message.
 * 
 * Strategy:
 * 1. Explicit 'clientConnectionId' field (preferred)
 * 2. For robot-to-client messages: 'to' field contains client connection ID
 *    - Only valid if 'from' matches the extracted robotId (confirms message is from robot)
 * 
 * Example (Rust format):
 * { type: "answer", from: "robot-id", to: "client-connection-id" }
 */
function extractClientConnectionId(
  raw: RawMessage,
  type: MessageType | undefined,
  robotId: string | undefined
): string | undefined {
  // Preferred: explicit clientConnectionId field
  if (typeof raw.clientConnectionId === 'string') {
    return raw.clientConnectionId.trim();
  }

  // For robot-to-client WebRTC messages, 'to' field is the client connection ID
  // Only use this if:
  // 1. Message type is a WebRTC signaling message
  // 2. We have a robotId
  // 3. 'from' field matches the robotId (confirms message is from robot)
  if (
    typeof raw.to === 'string' &&
    raw.to.trim().length > 0 &&
    (type === 'offer' || type === 'answer' || type === 'candidate' || type === 'ice-candidate') &&
    robotId &&
    typeof raw.from === 'string' &&
    raw.from.trim() === robotId
  ) {
    return raw.to.trim();
  }

  return undefined;
}

/**
 * Normalizes a raw message into the internal InboundMessage format.
 * 
 * This function handles multiple message formats and normalizes them into a consistent
 * structure. It supports both legacy formats and current formats for backward compatibility.
 * 
 * @param raw - The raw message object (can be any shape)
 * @returns Normalized InboundMessage with type, robotId, target, clientConnectionId, and payload
 */
function normalizeMessage(raw: RawMessage): InboundMessage {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const type = extractMessageType(raw);
  const robotId = extractRobotId(raw, type);
  const payload = extractPayload(raw);
  const target = extractTarget(raw);
  const clientConnectionId = extractClientConnectionId(raw, type, robotId);

  return {
    type,
    robotId,
    target,
    clientConnectionId,
    payload,
  };
}

/**
 * Creates a standardized error response for API Gateway.
 * 
 * All error responses follow a consistent format:
 * - statusCode: HTTP status code
 * - body: JSON string with 'error' message and optional details
 * - headers: Content-Type set to application/json
 * 
 * @param statusCode - HTTP status code (e.g., 400, 401, 403, 404, 500)
 * @param message - Human-readable error message
 * @param details - Optional additional error details (will be merged into response)
 * @returns Standardized error response object
 * 
 * @example
 * return errorResponse(400, 'robotId required');
 * return errorResponse(403, 'Access denied', { robotId: 'robot-123' });
 */
function errorResponse(
  statusCode: number,
  message: string,
  details?: Record<string, unknown>
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify({
      error: message,
      ...details,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Creates a standardized success response for API Gateway.
 * 
 * @param body - Optional response body (defaults to empty string)
 * @returns Standardized success response object
 */
function successResponse(body: string | object = ''): APIGatewayProxyResult {
  return {
    statusCode: 200,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

// Send a JSON messgae to a specific Websocket connection via Management API
async function postTo(connectionId: string, message: unknown): Promise<void> {
    try {
        await mgmt.send(
            new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: Buffer.from(JSON.stringify(message), 'utf-8'),
            }),
        );
    } catch (err: any) {
        // Ignore when the socket is already closed
        if (err?.name !== 'GoneException') {
            console.warn('post_to_connection error', err)
        }
    }
}

// Return the active connectionId for a robot or null if it's offline
async function findRobotConn(robotId: string): Promise<string | null> {
    const res = await db.send(
        new GetItemCommand({
            TableName: ROBOT_PRESENCE_TABLE,
            Key: { robotId: { S: robotId} },
        }),
    );
    return res.Item?.connectionId?.S ?? null;
}

// If caller is the robot owner, a delegated operator, or in an admin group return True
async function isOwnerOrAdmin(robotId: string, claims: { sub?: string; groups?: string[] }) : Promise<boolean> {
    const res = await db.send(
        new GetItemCommand({
            TableName: ROBOT_PRESENCE_TABLE,
            Key: { robotId: {S: robotId} },
        }),
    );
    const owner = res.Item?.ownerUserId?.S;
    const isAdmin = (claims.groups ?? []).some((g) => g === 'ADMINS' || g === 'admin');
    
    // Check if user is owner
    if (!!owner && owner === claims.sub) {
        return true;
    }
    
    // Check if user is admin
    if (isAdmin) {
        return true;
    }
    
    // Check if user is a delegated operator
    if (claims.sub && ROBOT_OPERATOR_TABLE) {
        try {
            const operatorCheck = await db.send(
                new QueryCommand({
                    TableName: ROBOT_OPERATOR_TABLE,
                    IndexName: "robotIdIndex",
                    KeyConditionExpression: "robotId = :robotId",
                    FilterExpression: "operatorUserId = :operatorUserId",
                    ExpressionAttributeValues: {
                        ":robotId": { S: robotId },
                        ":operatorUserId": { S: claims.sub },
                    },
                    Limit: 1,
                })
            );
            if (operatorCheck.Items && operatorCheck.Items.length > 0) {
                return true; // User is a delegated operator
            }
        } catch (error) {
            console.warn('Failed to check robot operator delegation:', error);
            // Fail closed - if we can't check delegation, deny access
        }
    }
    
    return false;
}

/**
 * Checks if a user can access a robot based on the ACL.
 * Returns true if:
 * - Robot has no ACL (null/empty) → open access
 * - User is owner, admin, or delegate → always allowed
 * - User's email/username is in the ACL
 */
async function canAccessRobot(robotId: string, claims: Claims, userEmailOrUsername?: string): Promise<boolean> {
    // Owner, admin, and delegates are always allowed
    const isAuthorized = await isOwnerOrAdmin(robotId, claims);
    if (isAuthorized) {
        return true;
    }

    // Get the robot from the Robot table to check ACL
    if (!ROBOT_TABLE_NAME) {
        console.warn('ROBOT_TABLE_NAME not set, cannot check ACL - allowing access');
        return true; // Fail open if we can't check
    }

    try {
        // Find the robot by robotId (string) in the Robot table
        // Use GSI (robotIdIndex) for fast, direct lookup instead of scanning entire table
        const queryResult = await db.send(
            new QueryCommand({
                TableName: ROBOT_TABLE_NAME,
                IndexName: 'robotIdIndex', // Use GSI for efficient lookup
                KeyConditionExpression: 'robotId = :robotId',
                ExpressionAttributeValues: {
                    ':robotId': { S: robotId },
                },
                Limit: 1,
            })
        );
        
        const robotItem = queryResult.Items?.[0];

        if (!robotItem) {
            // Robot not found in Robot table - might be a legacy robot or not registered
            // For now, allow access (fail open for backward compatibility)
            console.warn(`[ACL_CHECK] Robot ${robotId} not found in Robot table, allowing access (legacy robot)`);
            return true;
        }

        // Check if robot has an ACL field
        // If allowedUsers field doesn't exist, robot is open access (no ACL configured)
        if (!robotItem.allowedUsers) {
            console.log(`[ACL_CHECK] Robot ${robotId} has no ACL field - open access`);
            return true;
        }

        // Get the allowedUsers StringSet (SS) from DynamoDB
        // Handle both SS (StringSet) and other possible formats
        let allowedUsers: string[] = [];
        if (robotItem.allowedUsers.SS) {
            // Standard StringSet format
            allowedUsers = robotItem.allowedUsers.SS;
        } else if (Array.isArray(robotItem.allowedUsers)) {
            // Fallback: if it's already an array
            allowedUsers = robotItem.allowedUsers;
        }
        
        // If ACL is empty/null, robot is open access
        if (allowedUsers.length === 0) {
            console.log(`[ACL_CHECK] Robot ${robotId} has empty ACL - open access`);
            return true;
        }

        // Check if user's email/username is in the ACL
        // Try multiple identifiers: email, username, sub (as fallback)
        const userIdentifiers = [
            userEmailOrUsername?.toLowerCase(),
            claims.email?.toLowerCase(),
            (claims as any)['cognito:username']?.toLowerCase(),
            claims.sub, // Last resort - unlikely to match but included for completeness
        ].filter(Boolean) as string[];

        const normalizedAllowedUsers = allowedUsers.map(u => u.toLowerCase());
        
        console.log(`[ACL_CHECK] Checking access for robot ${robotId}:`, {
            userIdentifiers,
            allowedUsers: normalizedAllowedUsers,
        });
        
        for (const identifier of userIdentifiers) {
            if (normalizedAllowedUsers.includes(identifier.toLowerCase())) {
                console.log(`[ACL_CHECK] User ${identifier} found in ACL for robot ${robotId}`);
                return true;
            }
        }

        // User is not in ACL
        console.log(`[ACL_CHECK] User ${userEmailOrUsername || claims.email || claims.sub} not in ACL for robot ${robotId}`);
        return false;
    } catch (error) {
        // Log detailed error for debugging
        console.error('[ACL_CHECK_ERROR] Failed to check robot ACL:', {
            robotId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        
        // IMPORTANT: If we can't check the ACL due to an error, we need to decide:
        // - Fail closed (deny) = more secure but blocks legitimate users if there's a bug
        // - Fail open (allow) = less secure but better UX for legacy robots or temporary issues
        // 
        // For now, we'll fail open for robots that might not be in the table yet,
        // but log the error so we can investigate. This prevents blocking legitimate access
        // when there are infrastructure issues or robots that haven't been migrated yet.
        console.warn(`[ACL_CHECK] Error checking ACL for robot ${robotId}, allowing access (fail open for backward compatibility)`);
        return true; // Fail open to prevent blocking legitimate access
    }
}

// Helper to determine if user is an admin
function isAdmin(groups?: string[] | null): boolean {
    const gs = new Set((groups ?? []).map(g => g.toUpperCase()));
    return gs.has('ADMINS') || gs.has('ADMIN');
}

// Session Lock Check

/**
 * Check if a robot is currently locked by another user's active session.
 * Returns the locking user's info if robot is busy, null if available.
 * 
 * This provides server-side enforcement to prevent multiple clients
 * from controlling the same robot simultaneously, even if client-side
 * checks are bypassed.
 */
async function checkSessionLock(
  robotId: string, 
  currentUserId: string
): Promise<{ userId: string; userEmail?: string } | null> {
  if (!SESSION_TABLE_NAME) {
    console.warn('[SESSION_LOCK] SESSION_TABLE_NAME not set, skipping session lock check');
    return null;
  }

  try {
    const result = await db.send(new QueryCommand({
      TableName: SESSION_TABLE_NAME,
      IndexName: 'robotIdIndex',
      KeyConditionExpression: 'robotId = :robotId',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':robotId': { S: robotId },
        ':active': { S: 'active' },
      },
    }));

    const activeSessionByOther = result.Items?.find(item => {
      const sessionUserId = item.userId?.S;
      return sessionUserId && sessionUserId !== currentUserId;
    });

    if (activeSessionByOther) {
      console.log('[SESSION_LOCK_BLOCKED]', {
        robotId,
        currentUserId,
        lockingUserId: activeSessionByOther.userId?.S,
        lockingUserEmail: activeSessionByOther.userEmail?.S,
      });
      return {
        userId: activeSessionByOther.userId?.S || 'unknown',
        userEmail: activeSessionByOther.userEmail?.S,
      };
    }

    return null;
  } catch (err) {
    console.error('[SESSION_LOCK_ERROR]', {
      robotId,
      currentUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
<<<<<<< HEAD
 * Checks if user has sufficient credits for at least 1 minute of robot usage
 * Returns { sufficient: boolean, currentCredits: number, requiredCredits: number, error?: string }
 */
async function checkUserBalance(
  userId: string,
  robotId: string
): Promise<{ sufficient: boolean; currentCredits: number; requiredCredits: number; error?: string }> {
  if (!USER_CREDITS_TABLE || !ROBOT_TABLE_NAME) {
    console.warn('[BALANCE_CHECK] Missing environment variables, skipping balance check');
    return { sufficient: true, currentCredits: 0, requiredCredits: 0 }; // Allow if tables not configured
  }

  try {
    // 1. Get user's current credit balance (using DocumentClient for UserCredits table)
    let currentCredits = 0;
    if (USER_CREDITS_TABLE) {
      const userCreditsResult = await docClient.send(
        new DocQueryCommand({
          TableName: USER_CREDITS_TABLE,
          IndexName: 'userIdIndex',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
          Limit: 1,
        })
      );
      currentCredits = userCreditsResult.Items?.[0]?.credits || 0;
    }

    // 2. Get robot's hourly rate (using low-level API for Robot table)
    const robotResult = await db.send(new QueryCommand({
      TableName: ROBOT_TABLE_NAME,
      IndexName: 'robotIdIndex',
      KeyConditionExpression: 'robotId = :robotId',
      ExpressionAttributeValues: {
        ':robotId': { S: robotId },
      },
      Limit: 1,
    }));

    const robot = robotResult.Items?.[0];
    if (!robot) {
      return {
        sufficient: false,
        currentCredits,
        requiredCredits: 0,
        error: `Robot not found: ${robotId}`,
      };
    }

    const hourlyRateCredits = parseFloat(robot.hourlyRateCredits?.N || '100'); // Default 100 credits/hour

    // If robot is free (0 hourly rate), skip credit check
    if (hourlyRateCredits === 0) {
      console.log('[BALANCE_CHECK] Robot is free (0 hourly rate), skipping credit check', { robotId });
      return { sufficient: true, currentCredits, requiredCredits: 0 };
    }

    // 3. Get platform markup percentage (using DocumentClient for PlatformSettings table)
    let platformMarkupPercent = DEFAULT_PLATFORM_MARKUP_PERCENT;
    if (PLATFORM_SETTINGS_TABLE) {
      try {
        const settingsResult = await docClient.send(
          new DocQueryCommand({
            TableName: PLATFORM_SETTINGS_TABLE,
            IndexName: 'settingKeyIndex',
            KeyConditionExpression: 'settingKey = :key',
            ExpressionAttributeValues: {
              ':key': 'platformMarkupPercent',
            },
            Limit: 1,
          })
        );
        if (settingsResult.Items?.[0]?.settingValue) {
          platformMarkupPercent = parseFloat(settingsResult.Items[0].settingValue) || DEFAULT_PLATFORM_MARKUP_PERCENT;
        }
      } catch (err) {
        console.warn('[BALANCE_CHECK] Failed to fetch platform markup, using default:', err);
      }
    }

    // 4. Calculate cost for 1 minute (minimum session time)
    const durationMinutes = 1;
    const durationHours = durationMinutes / 60;
    const baseCostCredits = hourlyRateCredits * durationHours;
    const platformFeeCredits = baseCostCredits * (platformMarkupPercent / 100);
    const requiredCredits = baseCostCredits + platformFeeCredits;

    const sufficient = currentCredits >= requiredCredits;

    console.log('[BALANCE_CHECK]', {
      userId,
      robotId,
      currentCredits,
      requiredCredits,
      hourlyRateCredits,
      platformMarkupPercent,
      sufficient,
    });

    return {
      sufficient,
      currentCredits,
      requiredCredits,
      error: sufficient ? undefined : `Insufficient credits: have ${currentCredits.toFixed(2)}, need ${requiredCredits.toFixed(2)} for 1 minute`,
    };
  } catch (err) {
    console.error('[BALANCE_CHECK_ERROR]', {
      userId,
      robotId,
      error: err instanceof Error ? err.message : String(err),
    });
    // On error, allow session creation (fail open) but log the error
    return { sufficient: true, currentCredits: 0, requiredCredits: 0 };
  }
}

/**
 * Creates a new session for billing and tracking.
 * Checks for existing active sessions to prevent duplicates (e.g., from React StrictMode).
 * Returns existing session ID if one is already active for this user+robot combination.
 */
async function createSession(
  connectionId: string,
  userId: string,
  userEmail: string | undefined,
  robotId: string
): Promise<string | null> {
  if (!SESSION_TABLE_NAME) {
    console.warn('[SESSION] Table name not configured, skipping session creation');
    return null;
  }

  // Check for existing active session for this user+robot to prevent duplicates
  try {
    const existing = await db.send(new QueryCommand({
      TableName: SESSION_TABLE_NAME,
      IndexName: 'userIdIndex',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: '#status = :active AND robotId = :robotId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':userId': { S: userId },
        ':active': { S: 'active' },
        ':robotId': { S: robotId },
      },
      Limit: 1,
    }));
    
    if (existing.Items && existing.Items.length > 0) {
      const existingId = existing.Items[0].id?.S;
      console.log('[SESSION] Reusing existing active session:', { sessionId: existingId, userId, robotId });
      return existingId || null;
    }
  } catch (err) {
    console.warn('[SESSION] Failed to check for existing session:', err);
    // Continue with creation attempt
  }

  // Check user balance before creating session
  const balanceCheck = await checkUserBalance(userId, robotId);
  if (!balanceCheck.sufficient) {
    console.warn('[SESSION_CREATE_BLOCKED]', {
      userId,
      robotId,
      reason: 'insufficient_funds',
      currentCredits: balanceCheck.currentCredits,
      requiredCredits: balanceCheck.requiredCredits,
      error: balanceCheck.error,
    });
    return null; // Return null to indicate session creation was blocked
  }

  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();

  try {
    // End any other active sessions for this user (allows only one session at a time)
    await endUserSessions(userId);

    await db.send(new PutItemCommand({
      TableName: SESSION_TABLE_NAME,
      Item: {
        id: { S: sessionId },
        owner: { S: userId },
        userId: { S: userId },
        userEmail: { S: userEmail || '' },
        robotId: { S: robotId },
        robotName: { S: robotId },
        connectionId: { S: connectionId },
        startedAt: { S: now },
        status: { S: 'active' },
        createdAt: { S: now },
        updatedAt: { S: now },
        __typename: { S: 'Session' },
      },
    }));

    console.log('[SESSION] Created new session:', { sessionId, userId, robotId, connectionId });
    return sessionId;
  } catch (err) {
    console.error('[SESSION] Failed to create session:', {
      userId,
      robotId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function endSession(sessionId: string): Promise<void> {
  if (!SESSION_TABLE_NAME) return;

  const now = new Date().toISOString();

  try {
    const result = await db.send(new QueryCommand({
      TableName: SESSION_TABLE_NAME,
      KeyConditionExpression: 'id = :id',
      ExpressionAttributeValues: {
        ':id': { S: sessionId },
      },
      Limit: 1,
    }));

    if (!result.Items?.[0]) {
      console.warn('[SESSION] Cannot end session - not found:', sessionId);
      return;
    }

    const session = result.Items[0];
    const startedAt = session.startedAt?.S;
    const durationSeconds = startedAt 
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : 0;

    await db.send(new UpdateItemCommand({
      TableName: SESSION_TABLE_NAME,
      Key: { id: { S: sessionId } },
      UpdateExpression: 'SET #status = :completed, endedAt = :endedAt, durationSeconds = :duration, updatedAt = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':completed': { S: 'completed' },
        ':endedAt': { S: now },
        ':duration': { N: String(durationSeconds) },
        ':now': { S: now },
      },
    }));

    console.log('[SESSION] Ended session:', { sessionId, durationSeconds });
  } catch (err) {
    console.error('[SESSION] Failed to end session:', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function endUserSessions(userId: string): Promise<void> {
  if (!SESSION_TABLE_NAME) return;

  try {
    const result = await db.send(new QueryCommand({
      TableName: SESSION_TABLE_NAME,
      IndexName: 'userIdIndex',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':userId': { S: userId },
        ':active': { S: 'active' },
      },
    }));

    for (const item of result.Items || []) {
      const sessionId = item.id?.S;
      if (sessionId) {
        await endSession(sessionId);
      }
    }
  } catch (err) {
    console.error('[SESSION] Failed to end user sessions:', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function endConnectionSessions(connectionId: string): Promise<void> {
  if (!SESSION_TABLE_NAME) return;

  try {
    // Use GSI (connectionIdIndex) for fast, direct lookup instead of scanning entire table
    const result = await db.send(new QueryCommand({
      TableName: SESSION_TABLE_NAME,
      IndexName: 'connectionIdIndex', // Use GSI for efficient lookup
      KeyConditionExpression: 'connectionId = :connId',
      FilterExpression: '#status = :active', // Filter for active sessions only
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':connId': { S: connectionId },
        ':active': { S: 'active' },
      },
    }));

    for (const item of result.Items || []) {
      const sessionId = item.id?.S;
      if (sessionId) {
        console.log('[SESSION] Ending session on disconnect:', { sessionId, connectionId });
        await endSession(sessionId);
      }
    }
  } catch (err) {
    console.error('[SESSION] Failed to end connection sessions:', {
      connectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------
// $connect
// ---------------------------------
async function onConnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;
    const requestTime = new Date().toISOString();
    
    // Log connection attempt
    console.log('[CONNECTION_ATTEMPT]', {
        connectionId,
        requestTime,
        hasToken: !!event.queryStringParameters?.token,
        sourceIp: event.requestContext.identity?.sourceIp,
        userAgent: event.requestContext.identity?.userAgent,
    });
    
    // Clients / robots will pass ?token=<JWT> in the URL
    const token = event.queryStringParameters?.token ?? null;

    // DEVELOPMENT/TESTING MODE: Allow connections without token if ALLOW_NO_TOKEN is set
    // ⚠️ WARNING: Only enable this for local development/testing. NEVER in production!
    const allowNoToken = process.env.ALLOW_NO_TOKEN === 'true';
    
    if (allowNoToken && !token) {
        console.warn('⚠️ DEVELOPMENT MODE: Allowing connection without token (ALLOW_NO_TOKEN=true)');
        try {
            // Create a mock user for testing
            await db.send(
                new PutItemCommand({
                    TableName: CONN_TABLE,
                    Item: {
                        connectionId: { S: connectionId},
                        userId: { S: 'dev-test-user' },
                        username: { S: 'dev-test-user' },
                        groups: { S: 'PARTNERS' }, // Give dev user PARTNERS group for testing
                        kind: { S: 'client' },
                        ts: { N: String(Date.now()) },
                    },
                }),
            );
            console.log('[CONNECTION_SUCCESS]', { connectionId, mode: 'dev-no-token' });
            
            // Send connection ID back to client (dev mode)
            try {
                await postTo(connectionId, {
                    type: 'welcome',
                    connectionId: connectionId,
                });
            } catch (e) {
                console.warn('Failed to send welcome message:', e);
            }
        } catch (e) {
            console.warn('Connect put_item error', e);
            console.error('[CONNECTION_ERROR]', { connectionId, error: String(e) });
        }
        return {statusCode: 200, body: '' };
    }

    // Verify JWT token signature and expiration
    const claims = await verifyCognitoJWT(token);
    if (!claims?.sub) {
        console.error('[CONNECTION_REJECTED]', {
            connectionId,
            reason: 'Invalid or missing token',
            hasToken: !!token,
        });
        return errorResponse(401, 'Unauthorized');
    }

    try {
        // Store username/email for ACL checks
        const email = claims.email || '';
        const username = claims['cognito:username'] || claims.email || claims.sub || '';
        await db.send(
            new PutItemCommand({
                TableName: CONN_TABLE,
                Item: {
                    connectionId: { S: connectionId},
                    userId: { S: claims.sub },
                    username: { S: username },
                    email: { S: email },
                    groups: { S: (claims.groups ?? []).join(',')},
                    kind: { S: 'client' },
                    ts: { N: String(Date.now()) },
                    // monitoringRobotId will be set when monitor message is received
                },
            }),
        );
        console.log('[CONNECTION_SUCCESS]', {
            connectionId,
            userId: claims.sub,
            username,
            groups: claims.groups,
        });
    } catch (e) {
        console.warn('Connect put_item error', e);
        console.error('[CONNECTION_ERROR]', { connectionId, error: String(e) });
    }
    return {statusCode: 200, body: '' };
}

// ---------------------------------
// $disconnect
// ---------------------------------

async function onDisconnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;
    
    await endConnectionSessions(connectionId);
    
    try {
        await db.send(
            new DeleteItemCommand({
                TableName: CONN_TABLE,
                Key: { connectionId: {S : connectionId } },
            }),
        );
    } catch (e) {
        // If the entry is already gone we just log and move on
        console.warn('Disconnect delete_item error', e);
    }
    return {statusCode: 200, body: '' };
}

// ---------------------------------
// $register
// ---------------------------------

async function handleRegister(
  claims: { sub?: string; groups?: string[] },
  event: APIGatewayProxyEvent,
  msg: InboundMessage,
): Promise<APIGatewayProxyResult> {
  const robotId = msg.robotId;
  const connectionId = event.requestContext.connectionId!;
  
  if (!robotId) {
    console.error('[REGISTER_ERROR]', {
      connectionId,
      reason: 'robotId required',
      receivedMessage: msg,
    });
    return errorResponse(400, 'robotId required');
  }

  const caller = claims.sub!;
  const admin = isAdmin(claims.groups);
  
  console.log('[REGISTER_PROCESSING]', {
    connectionId,
    robotId,
    userId: caller,
    isAdmin: admin,
  });

  try {
    await db.send(
      new PutItemCommand({
        TableName: ROBOT_PRESENCE_TABLE,
        Item: {
          robotId: { S: robotId },
          ownerUserId: { S: caller },
          connectionId: { S: event.requestContext.connectionId! },
          status: { S: 'online' },
          updatedAt: { N: String(Date.now()) },
        },
        // Allow first-time claim OR re-claim by the same owner
        ConditionExpression: 'attribute_not_exists(ownerUserId) OR ownerUserId = :me',
        ExpressionAttributeValues: { ':me': { S: caller } },
      }),
    );
  } catch (e: any) {
    const code = e?.name || e?.Code || e?.code;
    if (code === 'ConditionalCheckFailedException' && !admin) {
      return errorResponse(409, 'Robot is already registered by another owner');
    }
    if (code === 'ConditionalCheckFailedException' && admin) {
      // Admin may force-claim
      await db.send(
        new PutItemCommand({
          TableName: ROBOT_PRESENCE_TABLE,
          Item: {
            robotId: { S: robotId },
            ownerUserId: { S: caller },
            connectionId: { S: event.requestContext.connectionId! },
            status: { S: 'online' },
            updatedAt: { N: String(Date.now()) },
          },
        }),
      );
    } else {
      console.warn('Presence put_item error', e);
      console.error('[REGISTER_ERROR]', {
        connectionId,
        robotId,
        error: String(e),
        errorCode: e?.name || e?.Code || e?.code,
      });
      return errorResponse(500, 'DynamoDB error');
    }
  }
  
  console.log('[REGISTER_SUCCESS]', {
    connectionId,
    robotId,
    userId: caller,
  });

  // Notify monitoring connections about the registration
  // Add _monitor flag and metadata to help logger identify and display the message
  const monitorMessage = {
    type: 'register',
    robotId: robotId,
    from: caller,
    _monitor: true, // Flag to indicate this is a monitor copy
    _source: connectionId,
    _direction: 'robot-to-server', // Robot is registering with the server
    timestamp: new Date().toISOString(),
  };
  await notifyMonitors(robotId, monitorMessage);
  
  return { statusCode: 200, body: '' };
}

// ---------------------------------
// $monitor - Subscribe to messages for a specific robot
// ---------------------------------

async function handleMonitor(
  claims: { sub?: string; groups?: string[] },
  event: APIGatewayProxyEvent,
  msg: InboundMessage,
): Promise<APIGatewayProxyResult> {
  const robotId = msg.robotId?.trim();
  const connectionId = event.requestContext.connectionId!;
  
  if (!robotId) {
    return errorResponse(400, 'robotId required for monitoring');
  }

  // Verify user has access to monitor this robot (must be owner, admin, or have ACL access)
  const hasAccess = await canAccessRobot(robotId, claims);
  if (!hasAccess) {
    console.log(`[MONITOR_DENIED]`, {
      connectionId,
      robotId,
      userId: claims.sub,
    });
    
    // Send error message to client through WebSocket (not just HTTP 403)
    // This ensures the user sees a clear error message
    try {
      await postTo(connectionId, {
        type: 'error',
        error: 'access_denied',
        message: 'You are not authorized to monitor this robot. The robot owner may have restricted access to specific users. Please contact the robot owner if you believe this is an error.',
        robotId: robotId,
      });
    } catch (e) {
      console.warn('Failed to send access denied message to client:', e);
    }
    
    return errorResponse(403, 'Access denied: You are not authorized to monitor this robot');
  }

    // Store monitoring subscription in ConnectionsTable
    // Use PutItem to replace the connection entry with monitoring info
    // This is safe because we include all necessary fields
    try {
      const claimsTyped = claims as Claims;
      const putItem = {
        connectionId: { S: connectionId },
        userId: { S: claims.sub ?? '' },
        username: { S: claimsTyped['cognito:username'] || claimsTyped.email || claims.sub || '' },
        groups: { S: (claims.groups ?? []).join(',') },
        kind: { S: 'monitor' },
        monitoringRobotId: { S: robotId }, // Store which robot this connection is monitoring
        ts: { N: String(Date.now()) },
      };
      
      console.log('[MONITOR_STORE_ATTEMPT]', {
        connectionId,
        robotId,
        userId: claims.sub,
        item: JSON.stringify(putItem),
      });
      
      await db.send(
        new PutItemCommand({
          TableName: CONN_TABLE,
          Item: putItem,
        }),
      );
      
      console.log('[MONITOR_SUBSCRIBED]', {
        connectionId,
        robotId,
        userId: claims.sub,
      });

    // Send confirmation to monitor
    await postTo(connectionId, {
      type: 'monitor-confirmed',
      robotId: robotId,
      message: `Now monitoring messages for robot ${robotId}`,
    });
  } catch (e) {
    console.error('[MONITOR_ERROR]', {
      connectionId,
      robotId,
      error: String(e),
    });
    return errorResponse(500, 'Failed to subscribe to monitoring');
  }

  return { statusCode: 200, body: '' };
}

// Helper function to get all monitoring connections for a robot
async function getMonitoringConnections(robotId: string): Promise<string[]> {
  try {
    // Use GSI (monitoringRobotIdIndex) for fast, direct lookup instead of scanning entire table
    console.log('[MONITOR_QUERY_START]', { robotId });
    const result = await db.send(
      new QueryCommand({
        TableName: CONN_TABLE,
        IndexName: 'monitoringRobotIdIndex', // Use GSI for efficient lookup
        KeyConditionExpression: 'monitoringRobotId = :robotId',
        ExpressionAttributeValues: {
          ':robotId': { S: robotId },
        },
        ProjectionExpression: 'connectionId',
      }),
    );
    
    const connections = (result.Items || [])
      .map(item => item.connectionId?.S)
      .filter((id): id is string => !!id);
    
    console.log('[MONITOR_QUERY_RESULT]', { 
      robotId, 
      foundConnections: connections.length,
      connectionIds: connections 
    });
    
    return connections;
  } catch (e) {
    console.error('[MONITOR_QUERY_ERROR]', { robotId, error: String(e) });
    return [];
  }
}

// Helper function to send message copies to monitoring connections
async function notifyMonitors(robotId: string, message: unknown): Promise<void> {
  console.log('[NOTIFY_MONITORS_START]', { robotId, messageType: (message as any)?.type });
  const monitorConnections = await getMonitoringConnections(robotId);
  
  if (monitorConnections.length === 0) {
    console.log('[NOTIFY_MONITORS_SKIP]', { 
      robotId, 
      reason: 'No monitoring connections found',
      messageType: (message as any)?.type 
    });
    return; // No monitors, skip
  }

  // Send copy to all monitoring connections
  const notifyPromises = monitorConnections.map(async (connId) => {
    try {
      await postTo(connId, message);
    } catch (err: any) {
      // Ignore GoneException (connection already closed)
      if (err?.name !== 'GoneException') {
        console.warn('[MONITOR_NOTIFY_ERROR]', {
          connectionId: connId,
          robotId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  await Promise.allSettled(notifyPromises);
  
  if (monitorConnections.length > 0) {
    console.log('[MONITOR_NOTIFIED]', {
      robotId,
      monitorCount: monitorConnections.length,
    });
  }
}

// ---------------------------------
// $takeover
// ---------------------------------

async function handleTakeover(
  claims: { sub?: string; groups?: string[] },
  msg: InboundMessage,
): Promise<APIGatewayProxyResult> {
  const robotId = msg.robotId?.trim();
  if (!robotId) return errorResponse(400, 'robotId required');

  // Need owner + connection to notify
  const got = await db.send(new GetItemCommand({
    TableName: ROBOT_PRESENCE_TABLE,
    Key: { robotId: { S: robotId } },
    ProjectionExpression: 'ownerUserId,connectionId',
  }));

  const owner = got.Item?.ownerUserId?.S;
  const robotConn = got.Item?.connectionId?.S;

  if (!owner || !robotConn) {
    return errorResponse(404, 'robot offline');
  }

  const caller = claims.sub ?? '';
  const admin = isAdmin(claims.groups);

  // Check if caller is owner, admin, or delegated operator
  const isAuthorized = await isOwnerOrAdmin(robotId, claims);
  if (!isAuthorized) {
    return errorResponse(403, 'forbidden');
  }

  await mgmt.send(new PostToConnectionCommand({
    ConnectionId: robotConn,
    Data: Buffer.from(JSON.stringify({
      type: 'admin-takeover',
      robotId,
      by: caller,
    }), 'utf-8'),
  }));

  return { statusCode: 200, body: 'ok' };
}

// ---------------------------------
// Offer / Answer / Ice-candidate forward
// ---------------------------------
async function handleSignal(
  claims: { sub?: string; groups?: string[] },
  event: APIGatewayProxyEvent,
  msg: InboundMessage,
): Promise<APIGatewayProxyResult> {
  const robotId = msg.robotId?.trim();
  const type = msg.type;
  
  // Log the incoming message for debugging
  console.log('[HANDLE_SIGNAL_INPUT]', {
    robotId,
    type,
    hasRobotId: !!robotId,
    hasType: !!type,
    clientConnectionId: msg.clientConnectionId,
    target: msg.target,
    payload: msg.payload,
    sourceConnectionId: event.requestContext.connectionId,
  });
  
  if (!robotId || !type) {
    console.error('[HANDLE_SIGNAL_REJECTED]', {
      reason: !robotId ? 'Missing robotId' : 'Missing type',
      robotId,
      type,
      message: JSON.stringify(msg),
    });
    return errorResponse(400, 'Invalid Signal');
  }

  // Get source connection ID (needed for logging and ACL checks)
  const sourceConnId = event.requestContext.connectionId!;
  
  // Auto-detect if message is from a robot by checking RobotPresenceTable
  // If source connection is registered as a robot, then this is a robot-to-client message
  let isFromRobot = false;
  try {
    const robotPresence = await db.send(new GetItemCommand({
      TableName: ROBOT_PRESENCE_TABLE,
      Key: { robotId: { S: robotId } },
      ProjectionExpression: 'connectionId',
    }));
    // If the source connection matches the robot's connection, this message is from the robot
    if (robotPresence.Item?.connectionId?.S === sourceConnId) {
      isFromRobot = true;
      console.log('[ROBOT_DETECTED]', {
        robotId,
        sourceConnectionId: sourceConnId,
        robotConnectionId: robotPresence.Item.connectionId.S,
      });
    }
  } catch (e) {
    console.warn('Failed to check robot presence for auto-detection:', e);
  }
  
  // If we detected it's from a robot but don't have clientConnectionId, try to get it from the original message
  // This handles the case where normalizeMessage didn't extract it (e.g., if 'to' field wasn't recognized)
  if (isFromRobot && !msg.clientConnectionId) {
    // Try to parse the original body to get the 'to' field
    try {
      const rawBody = JSON.parse(event.body ?? '{}');
      if (typeof rawBody.to === 'string' && rawBody.to.trim().length > 0 && rawBody.to !== robotId) {
        // The 'to' field should be the client connection ID
        msg.clientConnectionId = rawBody.to.trim();
        console.log('[EXTRACTED_CLIENT_CONNECTION_ID]', {
          robotId,
          clientConnectionId: msg.clientConnectionId,
          fromOriginalTo: rawBody.to,
        });
      }
    } catch (e) {
      console.warn('Failed to extract clientConnectionId from original message:', e);
    }
  }
  
  // Determine target: if message is from robot, target is 'client', otherwise default to 'robot'
  // But respect explicit 'target' field if provided
  let target: Target;
  if (msg.target) {
    target = (msg.target.toLowerCase() as Target);
  } else if (isFromRobot) {
    // Auto-detect: message from robot goes to client
    target = 'client';
  } else {
    // Default: message from client goes to robot
    target = 'robot';
  }
  
  if (target !== 'robot' && target !== 'client') {
    return errorResponse(400, 'invalid target');
  }

  // If target is robot, check ACL before allowing access
  if (target === 'robot') {
    // Get user's email/username from connection table for ACL check
    let userEmailOrUsername: string | undefined;
    let userEmail: string | undefined;
    try {
      const connItem = await db.send(new GetItemCommand({
        TableName: CONN_TABLE,
        Key: { connectionId: { S: sourceConnId } },
      }));
      userEmailOrUsername = connItem.Item?.username?.S;
      userEmail = connItem.Item?.email?.S; // Get stored email
    } catch (e) {
      console.warn('Failed to get username from connection table:', e);
    }

    // Check ACL - pass email as the primary identifier
    const hasAccess = await canAccessRobot(robotId, claims, userEmail || userEmailOrUsername);
    if (!hasAccess) {
      const userIdentifier = userEmailOrUsername || (claims as Claims).email || claims.sub || 'unknown';
      console.log(`Access denied: User ${userIdentifier} attempted to access robot ${robotId}`);
      
      // Send error message to client through WebSocket (not just HTTP 403)
      // This ensures the user sees a clear error message
      try {
        await postTo(sourceConnId, {
          type: 'error',
          error: 'access_denied',
          message: 'You are not authorized to access this robot. The robot owner may have restricted access to specific users. Please contact the robot owner if you believe this is an error.',
          robotId: robotId,
        });
      } catch (e) {
        console.warn('Failed to send access denied message to client:', e);
      }
      
      return errorResponse(403, 'Access denied: You are not authorized to access this robot');
    }

    // Server-side session lock enforcement
    // Only check for 'offer' messages (initial WebRTC connection attempts)
    // This prevents a second client from establishing control of a robot
    // that already has an active teleoperation session
    if (type === 'offer' || type === 'signalling.offer') {
      const currentUserIdentifier = userEmailOrUsername || claims.sub!;
      const sessionLock = await checkSessionLock(robotId, currentUserIdentifier);
      if (sessionLock) {
        console.log('[SESSION_LOCK_REJECTED]', {
          robotId,
          attemptingUser: currentUserIdentifier,
          lockingUser: sessionLock.userId,
          lockingUserEmail: sessionLock.userEmail,
          messageType: type,
        });
        
        try {
          await postTo(sourceConnId, {
            type: 'session-locked',
            robotId,
            lockedBy: sessionLock.userEmail || 'Another user',
          });
        } catch (e) {
          console.warn('[SESSION_LOCK_NOTIFY_ERROR]', e);
        }
        
        return errorResponse(423, 'Robot is currently controlled by another user', {
          lockedBy: sessionLock.userEmail || sessionLock.userId,
        });
      }
    }
  }

  // Determine destination
  let targetConn: string | undefined;
  if (target === 'client') {
    // For robot-to-client messages, clientConnectionId should be extracted from 'to' field
    // by normalizeMessage when message is from robot
    let ccid = msg.clientConnectionId?.trim();
    
    // If we don't have clientConnectionId but message is from robot, log a warning
    // but still allow the message to be monitored (for testing with placeholder values)
    if (!ccid && isFromRobot) {
      console.warn('[HANDLE_SIGNAL_WARNING]', {
        robotId,
        type,
        target,
        isFromRobot,
        hasClientConnectionId: !!msg.clientConnectionId,
        message: 'No clientConnectionId found for robot-to-client message. This may be a test message with placeholder "to" value. Message will be logged but not sent.',
      });
      // Set to placeholder so monitoring can still capture it
      targetConn = 'PLACEHOLDER_NO_CLIENT';
    } else if (!ccid) {
      console.error('[HANDLE_SIGNAL_ERROR]', {
        robotId,
        type,
        target,
        isFromRobot,
        hasClientConnectionId: !!msg.clientConnectionId,
        message: JSON.stringify(msg),
      });
      // Still set to placeholder so monitoring can capture it
      targetConn = 'PLACEHOLDER_NO_CLIENT';
    } else {
      targetConn = ccid;
    }
  } else {
    const robotItem = await db.send(new GetItemCommand({
      TableName: ROBOT_PRESENCE_TABLE,
      Key: { robotId: { S: robotId } },
      ProjectionExpression: 'connectionId',
    }));
    const robotConn = robotItem.Item?.connectionId?.S;
    if (!robotConn) {
      return errorResponse(404, 'target offline');
    }
    targetConn = robotConn;
  }

  // ============================================
  // MESSAGE FORMAT CHANGE - MATCHING AGENT EXPECTATIONS
  // ============================================
  // 
  // CHANGED: Modified outbound message format to match Modulr agent's expected format.
  // 
  // Previous format (what we were sending):
  //   { type, robotId, from, payload: { sdp, candidate } }
  // 
  // New format (what agent/browser expect):
  //   { type, to, from, sdp, candidate }  (all at top level)
  // 
  // This change was made because:
  // 1. Browser expects msg.sdp and msg.candidate at top level (useWebRTC.ts lines 213-217)
  // 2. Modulr agent expects { type, from, to, sdp, candidate } format
  // 
  // TO REVERT: Change this section back to:
  //   const outbound = {
  //     type,
  //     robotId,
  //     from: claims.sub ?? '',
  //     payload: msg.payload ?? {},
  //   };
  // 
  // ============================================
  
  // Extract sdp and candidate from payload to top level (for agent/browser compatibility)
  const payload = msg.payload ?? {};
  
  // Determine outbound type: preserve new protocol types, convert legacy ice-candidate to candidate
  let outboundType: string;
  if (type?.startsWith('signalling.') || type?.startsWith('agent.')) {
    outboundType = type; // Keep new protocol types as-is
  } else if (type === 'ice-candidate') {
    outboundType = 'candidate'; // Legacy conversion
  } else {
    outboundType = type || 'unknown';
  }
  
  const outbound: Record<string, unknown> = {
    type: outboundType,
    // For client-to-robot: to = robotId
    // For robot-to-client: to = clientConnectionId (from msg.clientConnectionId or original 'to' field)
    // Note: If targetConn is PLACEHOLDER_NO_CLIENT, we'll use that in the monitor message but not send it
    to: target === 'client' 
      ? (targetConn && targetConn !== 'PLACEHOLDER_NO_CLIENT' ? targetConn : (msg.clientConnectionId || 'PLACEHOLDER_NO_CLIENT'))
      : robotId,
    // IMPORTANT: Use connection ID as 'from' so robots can reply directly
    // - For robot messages: use robotId (robot identifier)
    // - For client messages: use sourceConnId (connection ID so robot can reply)
    from: isFromRobot ? robotId : sourceConnId, // If from robot, use robotId; otherwise use connection ID so robot can reply
  };
  
  // Unwrap sdp and candidate from payload to top level if present
  if (payload.sdp) {
    outbound.sdp = payload.sdp;
  }
  if (payload.candidate) {
    outbound.candidate = payload.candidate;
  }
  
  // Include any other payload fields (for future extensibility)
  // But prioritize top-level sdp/candidate for compatibility
  Object.keys(payload).forEach(key => {
    if (key !== 'sdp' && key !== 'candidate' && !outbound[key]) {
      outbound[key] = payload[key];
    }
  });

  // Log packet forwarding for verification
  console.log('[PACKET_FORWARD]', {
    timestamp: new Date().toISOString(),
    sourceConnectionId: sourceConnId,
    targetConnectionId: targetConn,
    messageType: type,
    robotId: robotId,
    fromUserId: claims.sub,
    target: target,
  });

  // Send copy to monitoring connections FIRST (before attempting to send)
  // This ensures messages appear in logger even if they can't be sent (e.g., placeholder client IDs)
  const monitorMessage = {
    ...outbound,
    _monitor: true, // Flag to indicate this is a monitor copy
    _source: sourceConnId,
    _target: targetConn,
    _direction: target === 'robot' ? 'client-to-robot' : 'robot-to-client',
  };
  await notifyMonitors(robotId, monitorMessage);

  // Only attempt to send if we have a valid target connection (not a placeholder)
  if (targetConn && targetConn !== 'PLACEHOLDER_NO_CLIENT') {
    try {
      await mgmt.send(new PostToConnectionCommand({
        ConnectionId: targetConn,
        Data: Buffer.from(JSON.stringify(outbound), 'utf-8'),
      }));
      console.log('[PACKET_FORWARD_SUCCESS]', {
        targetConnectionId: targetConn,
        messageType: type,
      });
      
      if ((type === 'offer' || type === 'signalling.offer') && target === 'robot' && claims?.sub) {
        let userEmail: string | undefined;
        let username: string | undefined;
        try {
          const connItem = await db.send(new GetItemCommand({
            TableName: CONN_TABLE,
            Key: { connectionId: { S: sourceConnId } },
            ProjectionExpression: 'email, username',
          }));
          userEmail = connItem.Item?.email?.S;
          username = connItem.Item?.username?.S;
        } catch (e) {
          console.warn('[SESSION_GET_USER_INFO_ERROR]', e);
        }
        
        const sessionUserId = username || claims.sub;
        const sessionId = await createSession(sourceConnId, sessionUserId, userEmail, robotId);
        
        // If session creation was blocked due to insufficient funds, send error to client
        if (!sessionId) {
          const balanceCheck = await checkUserBalance(sessionUserId, robotId);
          if (!balanceCheck.sufficient) {
            try {
              await postTo(sourceConnId, {
                type: 'error',
                error: 'insufficient_funds',
                message: balanceCheck.error || 'Insufficient credits to start session',
                currentCredits: balanceCheck.currentCredits,
                requiredCredits: balanceCheck.requiredCredits,
              });
              console.log('[INSUFFICIENT_FUNDS_NOTIFICATION_SENT]', {
                connectionId: sourceConnId,
                userId: sessionUserId,
                robotId,
              });
            } catch (err) {
              console.error('[FAILED_TO_SEND_INSUFFICIENT_FUNDS_ERROR]', {
                connectionId: sourceConnId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } else {
          // Send session ID to client when session is created
          try {
            await mgmt.send(new PostToConnectionCommand({
              ConnectionId: sourceConnId,
              Data: Buffer.from(JSON.stringify({
                type: 'session-created',
                sessionId: sessionId,
              }), 'utf-8'),
            }));
            console.log('[SESSION] Sent session ID to client:', { sessionId, connectionId: sourceConnId });
          } catch (e) {
            console.warn('[SESSION] Failed to send session ID to client:', e);
          }
        }
      }
    } catch (err) {
      // If the conn is gone, the caller will see a 200 from us but message won't deliver.
      // That's fine; $disconnect cleanup should remove stale items.
      console.warn('[PACKET_FORWARD_ERROR]', {
        targetConnectionId: targetConn,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    console.warn('[PACKET_FORWARD_SKIPPED]', {
      targetConnectionId: targetConn,
      messageType: type,
      reason: 'No valid target connection (placeholder or missing client connection ID)',
    });
  }

  return { statusCode: 200, body: '' };
}

// ---------------------------------
// Lambda entry point
// ---------------------------------

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const route = event.requestContext.routeKey;
  
  // Log all incoming events to help debug routing issues
  console.log('[LAMBDA_INVOCATION]', {
    route: route,
    connectionId: event.requestContext.connectionId,
    eventType: event.requestContext.eventType,
    requestId: event.requestContext.requestId,
    hasBody: !!event.body,
    bodyLength: event.body?.length || 0,
    queryParams: event.queryStringParameters ? Object.keys(event.queryStringParameters) : [],
  });

  // System routes
  if (route === '$connect') return onConnect(event);
  if (route === '$disconnect') return onDisconnect(event);

  // All other events come through $default
  // For $default route, the connection was already authenticated during $connect
  // Look up the connection in ConnectionsTable to get user claims
  const connectionId = event.requestContext.connectionId!;
  
  // Log that we're using the new authentication method
  console.log('[AUTH_METHOD_NEW]', {
    connectionId,
    timestamp: new Date().toISOString(),
    message: 'Using connection table lookup for authentication',
  });
  
  let claims: Claims | null = null;
  const token = event.queryStringParameters?.token ?? null; // Define token here for logging
  
  try {
    const connItem = await db.send(new GetItemCommand({
      TableName: CONN_TABLE,
      Key: { connectionId: { S: connectionId } },
      ProjectionExpression: 'userId, username, groups',
    }));
    
    if (connItem.Item) {
      const userId = connItem.Item.userId?.S;
      const username = connItem.Item.username?.S;
      const groupsStr = connItem.Item.groups?.S || '';
      const groups = groupsStr ? groupsStr.split(',').filter(Boolean) : [];
      
      if (userId) {
        claims = {
          sub: userId,
          groups: groups,
          'cognito:username': username,
          email: username?.includes('@') ? username : undefined,
        };
        console.log('[AUTH_FROM_CONNECTION_TABLE]', {
          connectionId,
          userId,
          username,
          groups,
        });
      } else {
        console.warn('[AUTH_LOOKUP_MISSING_USERID]', {
          connectionId,
          hasItem: !!connItem.Item,
          itemKeys: Object.keys(connItem.Item || {}),
        });
      }
    } else {
      console.warn('[AUTH_LOOKUP_NO_ITEM]', {
        connectionId,
        reason: 'Connection not found in ConnectionsTable',
      });
    }
  } catch (error) {
    console.error('[AUTH_LOOKUP_ERROR]', {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  
  // If we couldn't get claims from connection table, try token from query params (fallback)
  // This handles edge cases where connection might not be in table yet
  if (!claims?.sub) {
    
    // DEVELOPMENT/TESTING MODE: Allow messages without token if ALLOW_NO_TOKEN is set
    const allowNoToken = process.env.ALLOW_NO_TOKEN === 'true';
    
    if (allowNoToken && !token) {
      console.warn('⚠️ DEVELOPMENT MODE: Allowing message without token (ALLOW_NO_TOKEN=true)');
      claims = {
        sub: 'dev-test-user',
        groups: ['PARTNERS'],
        email: 'dev-test@modulr.cloud',
        'cognito:username': 'dev-test-user',
      };
    } else {
      claims = await verifyCognitoJWT(token);
      if (!claims?.sub) {
        console.error('[AUTH_FAILED]', {
          connectionId,
          hasToken: !!token,
          reason: 'No claims from connection table and token verification failed',
        });
        return errorResponse(401, 'Unauthorized');
      }
    }
  }

  // Parse raw JSON
  let raw: RawMessage = {};
  try {
    raw = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  // Normalize to our canonical shape
  const msg = normalizeMessage(raw);
  const type = (msg.type || '').toString().trim().toLowerCase();

  // Log incoming message
  console.log('[MESSAGE_RECEIVED]', {
    connectionId: event.requestContext.connectionId,
    route: route,
    messageType: type,
    robotId: msg.robotId,
    hasToken: !!token,
    userId: claims?.sub,
  });

  // Handle 'ready' message - send back connection ID
  if (raw?.type === 'ready') {
    console.log('[READY_MESSAGE]', { connectionId });
    try {
      await postTo(connectionId, {
        type: 'welcome',
        connectionId: connectionId,
      });
      return { statusCode: 200, body: 'ok' };
    } catch (e) {
      console.error('Failed to send welcome:', e);
      return errorResponse(500, 'failed to send welcome');
    }
  }

  // Dispatch by message type
  if (type === 'register') {
    console.log('[REGISTER_ATTEMPT]', {
      connectionId: event.requestContext.connectionId,
      robotId: msg.robotId,
      userId: claims?.sub,
    });
    return handleRegister(claims, event, msg);
  }

  if (type === 'monitor') {
    console.log('[MONITOR_MESSAGE_RECEIVED]', {
      connectionId: event.requestContext.connectionId,
      robotId: msg.robotId,
      userId: claims?.sub,
      message: msg,
    });
    return handleMonitor(claims, event, msg);
  }

  if (type === 'takeover') {
    return handleTakeover(claims, msg);
  }

  // Handle both legacy and new protocol signalling messages
  const signallingTypes = [
    'offer', 'answer', 'ice-candidate',
    'signalling.offer', 'signalling.answer', 'signalling.ice_candidate',
    'signalling.connected', 'signalling.disconnected'
  ];
  if (signallingTypes.includes(type)) {
    console.log('[ROUTING_TO_HANDLE_SIGNAL]', {
      type,
      robotId: msg.robotId,
      hasClaims: !!claims?.sub,
    });
    return handleSignal(claims, event, msg);
  }

  // Handle pong responses to keepalive pings (both legacy and new protocol)
  if (type === 'pong' || type === 'agent.pong') {
    const rawBody = event.body ? JSON.parse(event.body) : {};
    console.log('[PONG_RECEIVED]', {
      connectionId: event.requestContext.connectionId,
      robotId: msg.robotId,
      userId: claims?.sub,
      timestamp: rawBody.timestamp || rawBody.payload?.timestamp || 'not provided',
      protocol: type === 'agent.pong' ? 'v0.0' : 'legacy',
    });
    return successResponse({ type: 'pong-acknowledged' });
  }

  // Handle ping messages (both legacy and new protocol)
  if (type === 'ping' || type === 'agent.ping') {
    const rawBody = event.body ? JSON.parse(event.body) : {};
    console.log('[PING_RECEIVED]', {
      connectionId: event.requestContext.connectionId,
      robotId: msg.robotId,
      userId: claims?.sub,
      protocol: type === 'agent.ping' ? 'v0.0' : 'legacy',
    });
    // Respond with matching protocol format
    try {
      if (type === 'agent.ping') {
        await postTo(connectionId, {
          type: 'agent.pong',
          version: '0.0',
          id: `pong-${Date.now()}`,
          timestamp: new Date().toISOString(),
          correlationId: rawBody.id,
        });
      } else {
        await postTo(connectionId, {
          type: 'pong',
          timestamp: Date.now(),
          keepalive: true,
        });
      }
    } catch (err) {
      console.warn('[PING_RESPONSE_ERROR]', {
        connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return successResponse({ type: 'ping-acknowledged' });
  }

  // Log unknown message types for debugging
  console.warn('[UNKNOWN_MESSAGE_TYPE]', {
    type,
    robotId: msg.robotId,
    message: JSON.stringify(msg),
    rawBody: event.body,
  });

  return errorResponse(400, 'Unknown message type');
}