import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
    DynamoDBClient,
    PutItemCommand,
    DeleteItemCommand,
    GetItemCommand,
    QueryCommand,
    ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { createHash } from 'crypto';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const CONN_TABLE = process.env.CONN_TABLE!;
const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const REVOKED_TOKENS_TABLE = process.env.REVOKED_TOKENS_TABLE!;
const ROBOT_OPERATOR_TABLE = process.env.ROBOT_OPERATOR_TABLE!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT!; // HTTPS management API
const USER_POOL_ID = process.env.USER_POOL_ID!;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const db = new DynamoDBClient({});
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT});

// Cognito JWKS URL - public keys for verifying JWT signatures
const JWKS_URL = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`;
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

// ---------------------------------
// Types
// ---------------------------------

type MessageType = 'register' | 'offer' | 'answer' | 'ice-candidate' | 'takeover' | 'candidate';
type Target = 'robot' | 'client';

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

// Normalize message to this implementation
function normalizeMessage(raw: RawMessage): InboundMessage {
  if (!raw || typeof raw !== 'object') return {};

  let type: MessageType | undefined;
    if (typeof raw.type === 'string') {
    const t = raw.type.toLowerCase();
    if (t === 'candidate') {
      type = 'ice-candidate'; // map legacy name to internal name
    } else if (
      t === 'offer' ||
      t === 'answer' ||
      t === 'register' ||
      t === 'takeover' ||
      t === 'ice-candidate'
    ) {
      type = t as MessageType;
    }
  }

  // ---- robotId ----
  // Preferred: explicit 'robotId' (Robot.id / UUID).
  // Fallback: Mike's 'to' field if present.
  let robotId: string | undefined;
  if (typeof raw.robotId === 'string' && raw.robotId.trim().length > 0) {
    robotId = raw.robotId.trim();
  } else if (typeof raw.to === 'string' && raw.to.trim().length > 0) {
    robotId = raw.to.trim();
  }

  // ---- payload ----
  // Preferred: 'payload' object.
  // Also fold in 'sdp' and 'candidate' if present (Mike's WebRTC messages).
  let payload: Record<string, unknown> | undefined;
  if (raw.payload && typeof raw.payload === 'object') {
    payload = { ...raw.payload };
  }

  if (raw.sdp) {
    payload = payload ?? {};
    payload.sdp = raw.sdp;
  }
  if (raw.candidate) {
    payload = payload ?? {};
    payload.candidate = raw.candidate;
  }

  // ---- target / clientConnectionId ----
  const target =
    typeof raw.target === 'string'
      ? (raw.target.toLowerCase() as Target)
      : undefined;

  const clientConnectionId =
    typeof raw.clientConnectionId === 'string'
      ? raw.clientConnectionId.trim()
      : undefined;

  return {
    type,
    robotId,
    target,
    clientConnectionId,
    payload,
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
        // Since there's no index on robotId, we need to scan (less efficient but works)
        // In production, consider adding a GSI on robotId for better performance
        const scanResult = await db.send(
            new ScanCommand({
                TableName: ROBOT_TABLE_NAME,
                FilterExpression: 'robotId = :robotId',
                ExpressionAttributeValues: {
                    ':robotId': { S: robotId },
                },
                Limit: 1,
            })
        );
        
        const robotItem = scanResult.Items?.[0];

        if (!robotItem) {
            // Robot not found in Robot table - might be a legacy robot or not registered
            // For now, allow access (fail open)
            console.warn(`Robot ${robotId} not found in Robot table, allowing access`);
            return true;
        }

        const allowedUsers = robotItem.allowedUsers?.SS || [];
        
        // If ACL is empty/null, robot is open access
        if (allowedUsers.length === 0) {
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
        
        for (const identifier of userIdentifiers) {
            if (normalizedAllowedUsers.includes(identifier.toLowerCase())) {
                return true;
            }
        }

        // User is not in ACL
        console.log(`User ${userEmailOrUsername || claims.email || claims.sub} not in ACL for robot ${robotId}`);
        return false;
    } catch (error) {
        console.warn('Failed to check robot ACL:', error);
        // Fail open - if we can't check ACL, allow access (availability over security)
        return true;
    }
}

// Helper to determine if user is an admin
function isAdmin(groups?: string[] | null): boolean {
    const gs = new Set((groups ?? []).map(g => g.toUpperCase()));
    return gs.has('ADMINS') || gs.has('ADMIN');
}

// ---------------------------------
// $connect
// ---------------------------------
async function onConnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    // Clients / robots will pass ?token=<JWT> in the URL
    const token = event.queryStringParameters?.token ?? null;

    // DEVELOPMENT/TESTING MODE: Allow connections without token if ALLOW_NO_TOKEN is set
    // ⚠️ WARNING: Only enable this for local development/testing. NEVER in production!
    const allowNoToken = process.env.ALLOW_NO_TOKEN === 'true';
    
    if (allowNoToken && !token) {
        console.warn('⚠️ DEVELOPMENT MODE: Allowing connection without token (ALLOW_NO_TOKEN=true)');
        const connectionId = event.requestContext.connectionId!;
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
        } catch (e) {
            console.warn('Connect put_item error', e);
        }
        return {statusCode: 200, body: '' };
    }

    // Verify JWT token signature and expiration
    const claims = await verifyCognitoJWT(token);
    if (!claims?.sub) {
        return {statusCode: 401, body: 'unauthorized'};
    }

    const connectionId = event.requestContext.connectionId!;
    try {
        // Store username/email for ACL checks
        const username = claims['cognito:username'] || claims.email || claims.sub || '';
        await db.send(
            new PutItemCommand({
                TableName: CONN_TABLE,
                Item: {
                    connectionId: { S: connectionId},
                    userId: { S: claims.sub },
                    username: { S: username }, // Store for ACL checks
                    groups: { S: (claims.groups ?? []).join(',')},
                    kind: { S: 'client' },
                    ts: { N: String(Date.now()) },
                },
            }),
        );
    } catch (e) {
        console.warn('Connect put_item error', e);
    }
    return {statusCode: 200, body: '' };
}

// ---------------------------------
// $disconnect
// ---------------------------------

async function onDisconnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;
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
  if (!robotId) return { statusCode: 400, body: 'robotId required' };

  const caller = claims.sub!;
  const admin = isAdmin(claims.groups);

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
      return { statusCode: 409, body: 'Robot is already registered by another owner' };
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
      return { statusCode: 500, body: 'DynamoDB error' };
    }
  }
  return { statusCode: 200, body: '' };
}

// ---------------------------------
// $takeover
// ---------------------------------

async function handleTakeover(
  claims: { sub?: string; groups?: string[] },
  msg: InboundMessage,
): Promise<APIGatewayProxyResult> {
  const robotId = msg.robotId?.trim();
  if (!robotId) return { statusCode: 400, body: 'robotId required' };

  // Need owner + connection to notify
  const got = await db.send(new GetItemCommand({
    TableName: ROBOT_PRESENCE_TABLE,
    Key: { robotId: { S: robotId } },
    ProjectionExpression: 'ownerUserId,connectionId',
  }));

  const owner = got.Item?.ownerUserId?.S;
  const robotConn = got.Item?.connectionId?.S;

  if (!owner || !robotConn) {
    return { statusCode: 404, body: 'robot offline' };
  }

  const caller = claims.sub ?? '';
  const admin = isAdmin(claims.groups);

  // Check if caller is owner, admin, or delegated operator
  const isAuthorized = await isOwnerOrAdmin(robotId, claims);
  if (!isAuthorized) {
    return { statusCode: 403, body: 'forbidden' };
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
  if (!robotId || !type) return { statusCode: 400, body: 'Invalid Signal' };

  const target = (msg.target ?? 'robot').toLowerCase();
  if (target !== 'robot' && target !== 'client') {
    return { statusCode: 400, body: 'invalid target' };
  }

  // Get source connection ID (needed for logging and ACL checks)
  const sourceConnId = event.requestContext.connectionId!;

  // If target is robot, check ACL before allowing access
  if (target === 'robot') {
    // Get user's email/username from connection table for ACL check
    let userEmailOrUsername: string | undefined;
    try {
      const connItem = await db.send(new GetItemCommand({
        TableName: CONN_TABLE,
        Key: { connectionId: { S: sourceConnId } },
        ProjectionExpression: 'username',
      }));
      userEmailOrUsername = connItem.Item?.username?.S;
    } catch (e) {
      console.warn('Failed to get username from connection table:', e);
    }

    // Check ACL
    const hasAccess = await canAccessRobot(robotId, claims, userEmailOrUsername);
    if (!hasAccess) {
      const userIdentifier = userEmailOrUsername || (claims as Claims).email || claims.sub || 'unknown';
      console.log(`Access denied: User ${userIdentifier} attempted to access robot ${robotId}`);
      return { statusCode: 403, body: 'Access denied: You are not authorized to access this robot' };
    }
  }

  // Determine destination
  let targetConn: string | undefined;
  if (target === 'client') {
    const ccid = msg.clientConnectionId?.trim();
    if (!ccid) {
      return { statusCode: 400, body: 'clientConnectionId required for target=client' };
    }
    targetConn = ccid;
  } else {
    const robotItem = await db.send(new GetItemCommand({
      TableName: ROBOT_PRESENCE_TABLE,
      Key: { robotId: { S: robotId } },
      ProjectionExpression: 'connectionId',
    }));
    const robotConn = robotItem.Item?.connectionId?.S;
    if (!robotConn) {
      return { statusCode: 404, body: 'target offline' };
    }
    targetConn = robotConn;
  }

  // Forward
  const outbound = {
    type,
    robotId,
    from: claims.sub ?? '', // could also use event.requestContext.connectionId
    payload: msg.payload ?? {},
  };

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

  try {
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: targetConn!,
      Data: Buffer.from(JSON.stringify(outbound), 'utf-8'),
    }));
    console.log('[PACKET_FORWARD_SUCCESS]', {
      targetConnectionId: targetConn,
      messageType: type,
    });
  } catch (err) {
    // If the conn is gone, the caller will see a 200 from us but message won't deliver.
    // That's fine; $disconnect cleanup should remove stale items.
    console.warn('[PACKET_FORWARD_ERROR]', {
      targetConnectionId: targetConn,
      error: err instanceof Error ? err.message : String(err),
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

  // System routes
  if (route === '$connect') return onConnect(event);
  if (route === '$disconnect') return onDisconnect(event);

  // All other events come through $default
  const token = event.queryStringParameters?.token ?? null;
  
  // DEVELOPMENT/TESTING MODE: Allow messages without token if ALLOW_NO_TOKEN is set
  const allowNoToken = process.env.ALLOW_NO_TOKEN === 'true';
  let claims: Claims | null = null;
  
  if (allowNoToken && !token) {
    console.warn('⚠️ DEVELOPMENT MODE: Allowing message without token (ALLOW_NO_TOKEN=true)');
    // Create mock claims for testing
    claims = {
      sub: 'dev-test-user',
      groups: ['PARTNERS'],
      email: 'dev-test@modulr.cloud',
      'cognito:username': 'dev-test-user',
    };
  } else {
    claims = await verifyCognitoJWT(token);
    if (!claims?.sub) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
  }

  // Parse raw JSON
  let raw: RawMessage = {};
  try {
    raw = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Normalize to our canonical shape
  const msg = normalizeMessage(raw);
  const type = (msg.type || '').toString().trim().toLowerCase();

  // Dispatch by message type
  if (type === 'register') {
    return handleRegister(claims, event, msg);
  }

  if (type === 'takeover') {
    return handleTakeover(claims, msg);
  }

  if (type === 'offer' || type === 'answer' || type === 'ice-candidate') {
    return handleSignal(claims, event, msg);
  }

  return { statusCode: 400, body: 'Unknown message type' };
}