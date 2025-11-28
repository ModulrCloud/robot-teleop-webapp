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

type MessageType = 'register' | 'offer' | 'answer' | 'ice-candidate' | 'takeover' | 'candidate' | 'monitor';
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
      t === 'ice-candidate' ||
      t === 'monitor'
    ) {
      type = t as MessageType;
    }
  }

  // ---- robotId ----
  // Preferred: explicit 'robotId' (Robot.id / UUID).
  // For robot messages: 'from' field contains robotId (check this FIRST to avoid conflicts)
  // For client messages: 'to' field contains robotId
  //   - Rust agent sends: { type: "register", from: "robot-id" }
  //   - Rust agent sends: { type: "offer", from: "robot-id", to: "client-id", sdp: "..." }
  //   - Rust agent sends: { type: "candidate", from: "robot-id", to: "client-id", candidate: {...} }
  let robotId: string | undefined;
  if (typeof raw.robotId === 'string' && raw.robotId.trim().length > 0) {
    robotId = raw.robotId.trim();
  } else if (typeof raw.from === 'string' && raw.from.trim().length > 0) {
    // For robot-to-client messages: { type: "offer", from: "robot-id", to: "client-id" }
    // Also for registration: { type: "register", from: "robot-id" }
    // Check 'from' FIRST for robot messages to avoid using 'to' as robotId
    if (type === 'register' || type === 'offer' || type === 'answer' || type === 'candidate' || type === 'ice-candidate') {
      robotId = raw.from.trim();
    }
  }
  
  // Only use 'to' as robotId if we haven't already extracted it from 'from'
  // This handles client-to-robot messages: { type: "offer", to: "robot-id", from: "client-id" }
  if (!robotId && typeof raw.to === 'string' && raw.to.trim().length > 0) {
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

  // Extract clientConnectionId:
  // 1. Explicit clientConnectionId field
  // 2. For robot-to-client messages: 'to' field contains client connection ID
  //    (Rust format: { type: "answer", from: "robot-id", to: "client-connection-id" })
  let clientConnectionId: string | undefined;
  if (typeof raw.clientConnectionId === 'string') {
    clientConnectionId = raw.clientConnectionId.trim();
  } else if (
    typeof raw.to === 'string' && 
    raw.to.trim().length > 0 &&
    (type === 'offer' || type === 'answer' || type === 'candidate' || type === 'ice-candidate') &&
    robotId && // If we have a robotId, this might be from robot
    typeof raw.from === 'string' && raw.from.trim() === robotId // Confirm 'from' matches robotId
  ) {
    // For robot-to-client messages, 'to' field is the client connection ID
    // Only use this if 'from' matches the robotId we extracted (confirms message is from robot)
    clientConnectionId = raw.to.trim();
  }

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
        return {statusCode: 401, body: 'unauthorized'};
    }

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
    return { statusCode: 400, body: 'robotId required' };
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
      console.error('[REGISTER_ERROR]', {
        connectionId,
        robotId,
        error: String(e),
        errorCode: e?.name || e?.Code || e?.code,
      });
      return { statusCode: 500, body: 'DynamoDB error' };
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
    return { statusCode: 400, body: 'robotId required for monitoring' };
  }

  // Verify user has access to monitor this robot (must be owner, admin, or have ACL access)
  const hasAccess = await canAccessRobot(robotId, claims);
  if (!hasAccess) {
    console.log(`[MONITOR_DENIED]`, {
      connectionId,
      robotId,
      userId: claims.sub,
    });
    return { statusCode: 403, body: 'Access denied: You are not authorized to monitor this robot' };
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
    return { statusCode: 500, body: 'Failed to subscribe to monitoring' };
  }

  return { statusCode: 200, body: '' };
}

// Helper function to get all monitoring connections for a robot
async function getMonitoringConnections(robotId: string): Promise<string[]> {
  try {
    // Scan ConnectionsTable for connections monitoring this robot
    // Note: This is a scan operation. For better performance, consider adding a GSI on monitoringRobotId
    console.log('[MONITOR_QUERY_START]', { robotId });
    const result = await db.send(
      new ScanCommand({
        TableName: CONN_TABLE,
        FilterExpression: 'monitoringRobotId = :robotId',
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
    return { statusCode: 400, body: 'Invalid Signal' };
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
    return { statusCode: 400, body: 'invalid target' };
  }

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
      return { statusCode: 404, body: 'target offline' };
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
  
  // Convert internal 'ice-candidate' type to 'candidate' for Rust agent compatibility
  // Rust agent expects: { type: "candidate", ... }
  // Browser also expects: type: "candidate" (see useWebRTC.ts line 215)
  const outboundType = type === 'ice-candidate' ? 'candidate' : type;
  
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
        return { statusCode: 401, body: 'Unauthorized' };
      }
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

  // Log incoming message
  console.log('[MESSAGE_RECEIVED]', {
    connectionId: event.requestContext.connectionId,
    route: route,
    messageType: type,
    robotId: msg.robotId,
    hasToken: !!token,
    userId: claims?.sub,
  });

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

  if (type === 'offer' || type === 'answer' || type === 'ice-candidate') {
    console.log('[ROUTING_TO_HANDLE_SIGNAL]', {
      type,
      robotId: msg.robotId,
      hasClaims: !!claims?.sub,
    });
    return handleSignal(claims, event, msg);
  }

  // Log unknown message types for debugging
  console.warn('[UNKNOWN_MESSAGE_TYPE]', {
    type,
    robotId: msg.robotId,
    message: JSON.stringify(msg),
    rawBody: event.body,
  });

  return { statusCode: 400, body: 'Unknown message type' };
}