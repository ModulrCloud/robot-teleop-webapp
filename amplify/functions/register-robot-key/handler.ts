import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { timingSafeEqual, randomBytes } from 'crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const ddbClient = new DynamoDBClient({});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Ed25519 public key is 32 bytes. Accept base64, base64url, or hex. */
function decodeAndValidateEd25519PublicKey(input: string): Buffer {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Public key cannot be empty");
  }
  let decoded: Buffer;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 64) {
    decoded = Buffer.from(trimmed, 'hex');
  } else {
    const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+(?:={0,2})$/.test(base64)) {
      throw new Error("Public key must be base64, base64url, or hex (64 hex chars for 32-byte Ed25519 key)");
    }
    try {
      decoded = Buffer.from(base64, 'base64');
    } catch {
      throw new Error("Public key must be base64, base64url, or hex (64 hex chars for 32-byte Ed25519 key)");
    }
  }
  if (decoded.length !== 32) {
    throw new Error(`Invalid Ed25519 public key: expected 32 bytes after decode, got ${decoded.length}`);
  }
  return decoded;
}

function respond(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  // CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.requestContext.http.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const robotIdIndex = process.env.ROBOT_ID_INDEX!;

  if (!robotTableName || !robotIdIndex) {
    return respond(500, { error: 'Server configuration error' });
  }

  let body: { robotId?: string; enrollmentToken?: string; publicKey?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { robotId, enrollmentToken, publicKey } = body;

  if (!robotId || !enrollmentToken || !publicKey) {
    return respond(400, { error: 'robotId, enrollmentToken, and publicKey are required' });
  }

  // Look up robot by robotId string (robot-XXXXXXXX) via GSI
  const queryResult = await ddbClient.send(
    new QueryCommand({
      TableName: robotTableName,
      IndexName: robotIdIndex,
      KeyConditionExpression: 'robotId = :robotId',
      ExpressionAttributeValues: { ':robotId': { S: robotId } },
      Limit: 1,
    })
  );

  const robotItem = queryResult.Items?.[0];
  if (!robotItem) {
    return respond(400, { error: 'Robot not found' });
  }

  const storedToken = robotItem.enrollmentToken?.S;
  const storedExpiry = robotItem.enrollmentTokenExpiry?.N;
  const robotUuid = robotItem.id?.S;

  if (!storedToken || !storedExpiry || !robotUuid) {
    return respond(400, { error: 'No enrollment pending for this robot' });
  }

  // Constant-time token comparison
  let tokenMatch = false;
  try {
    const submittedBuf = Buffer.from(enrollmentToken, 'utf8');
    const storedBuf = Buffer.from(storedToken, 'utf8');
    // Pad to same length before comparing to avoid length-leaking, but also check lengths
    if (submittedBuf.length === storedBuf.length) {
      tokenMatch = timingSafeEqual(submittedBuf, storedBuf);
    }
    // If lengths differ, tokenMatch stays false
  } catch {
    tokenMatch = false;
  }

  // Check token match and expiry with a single generic error message to prevent oracle attacks
  if (!tokenMatch || Date.now() > Number(storedExpiry)) {
    return respond(400, { error: 'Invalid or expired enrollment token' });
  }

  // Validate public key format
  let normalizedKey: string;
  try {
    const keyBytes = decodeAndValidateEd25519PublicKey(publicKey);
    // Normalise to base64 for storage
    normalizedKey = keyBytes.toString('base64');
  } catch (e) {
    return respond(400, { error: `Invalid public key: ${(e as Error).message}` });
  }

  // Set publicKey, clear enrollment token fields
  await ddbClient.send(new UpdateItemCommand({
    TableName: robotTableName,
    Key: { id: { S: robotUuid } },
    UpdateExpression: 'SET #publicKey = :publicKey REMOVE #enrollmentToken, #enrollmentTokenExpiry',
    ExpressionAttributeNames: {
      '#publicKey': 'publicKey',
      '#enrollmentToken': 'enrollmentToken',
      '#enrollmentTokenExpiry': 'enrollmentTokenExpiry',
    },
    ExpressionAttributeValues: {
      ':publicKey': { S: normalizedKey },
    },
  }));

  return respond(200, { success: true });
};
