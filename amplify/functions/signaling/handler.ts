import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
    DynamoDBClient,
    PutItemCommand,
    DeleteItemCommand,
    GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const CONN_TABLE = process.env.CONN_TABLE!;
const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
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
 * Verifies and decodes a Cognito JWT token.
 * Validates signature, expiration, issuer, and audience.
 * Returns null if token is invalid or expired.
 */
async function verifyCognitoJWT(token: string | null | undefined): Promise<{sub?: string; groups?: string[]; aud?: string} | null> {
    if (!token) return null;
    
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

// If caller is the robot owner or in an admin group return True
async function isOwnerOrAdmin(robotId: string, claims: { sub?: string; groups?: string[] }) : Promise<boolean> {
    const res = await db.send(
        new GetItemCommand({
            TableName: ROBOT_PRESENCE_TABLE,
            Key: { robotId: {S: robotId} },
        }),
    );
    const owner = res.Item?.ownerUserId?.S;
    const isAdmin = (claims.groups ?? []).some((g) => g === 'ADMINS' || g === 'admin');
    return isAdmin || (!!owner && owner === claims.sub);
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

    // Verify JWT token signature and expiration
    const claims = await verifyCognitoJWT(token);
    if (!claims?.sub) {
        return {statusCode: 401, body: 'unauthorized'};
    }

    const connectionId = event.requestContext.connectionId!;
    try {
        await db.send(
            new PutItemCommand({
                TableName: CONN_TABLE,
                Item: {
                    connectionId: { S: connectionId},
                    userId: { S: claims.sub },
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

  if (!admin && caller !== owner) {
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

  try {
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: targetConn!,
      Data: Buffer.from(JSON.stringify(outbound), 'utf-8'),
    }));
  } catch (err) {
    // If the conn is gone, the caller will see a 200 from us but message won't deliver.
    // That’s fine; $disconnect cleanup should remove stale items.
    console.warn('forward error', err);
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
  const claims = await verifyCognitoJWT(token);
  if (!claims?.sub) {
    return { statusCode: 401, body: 'Unauthorized' };
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