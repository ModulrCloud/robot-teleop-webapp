import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
    DynamoDBClient,
    PutItemCommand,
    DeleteItemCommand,
    GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import {ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'

const CONN_TABLE = process.env.CONN_TABLE!;
const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT!; // HTTPS management API

const db = new DynamoDBClient({});
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT});

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

// ---------------------------------
// Helpers
// ---------------------------------

const nowMs = () => Date.now();

// NOTE: Decode a JWT without verifying the signature will replace with
// cognito verification later

function decodeJwtNoVerify(token: string | null | undefined): {sub?: string; groups?: string[]; aud?: string} | null{
    if (!token) return null;
    try {
        const parts = token.trim().split('.');
        if (parts.length !== 3) return null;
        const payloadB64 = parts[1];
        const pad = '='.repeat((4 - (payloadB64.length % 4)) % 4);
        const json = Buffer.from(payloadB64 + pad, 'base64url').toString('utf-8');
        const payload = JSON.parse(json);
        return{
            sub: payload.sub ?? '',
            groups: (payload['cognito:groups'] as string[] | undefined) ?? [],
            aud: payload.aud ?? '',
        };
    } catch {
        return null;
    }
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
    // Clients / robots will pass ?token<JWT> in teh URL
    const token = event.queryStringParameters?.token ?? null;

    // TEMP: decode w/o verification (this will be swpped later for cognito)
    const claims = decodeJwtNoVerify(token);
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

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const route = event.requestContext.routeKey;

    // System routes
    if (route === '$connect') return onConnect(event);
    if (route === '$disconnect') return onDisconnect(event);

    // All other events come through $default
    const token = event.queryStringParameters?.token ?? null;
    const claims = decodeJwtNoVerify(token);
    if (!claims?.sub) {
        return { statusCode: 401, body: 'Unauthorized' };
    }

    // Parse the inbound JSON message
    let msg: InboundMessage = {};
    try {
        msg = JSON.parse(event.body ?? '{}');
    } catch {
        return { statusCode: 400, body: 'Invalid JSON'};
    }

    const type = (msg.type || '').toString().trim().toLowerCase();

    //Dispatch by message type
    if (type === 'register') {
        return handleRegister(claims, event, msg);
    }
    
    if (type === 'takeover') {
        return handleTakeover(claims, msg);
    }

    if (type === 'offer' || type === 'answer' || type === 'ice-candidate') {
        return handleSignal(claims, event, msg);
    }

    return { statusCode: 400, body: 'Unknown message type'};
}