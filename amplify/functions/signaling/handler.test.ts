//-------------------------------
// AI Generated Itergration Tests
//-------------------------------

// amplify/functions/signaling/handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Hoisted fns so mocks can reference them safely ----------
const { ddbSend, apigwSend } = vi.hoisted(() => {
  return {
    ddbSend: vi.fn(),
    apigwSend: vi.fn(),
  };
});

// ---------- Mock env before importing the module ----------
process.env.CONN_TABLE = 'LocalConnections';
process.env.ROBOT_PRESENCE_TABLE = 'LocalPresence';
process.env.REVOKED_TOKENS_TABLE = 'LocalRevokedTokens';
process.env.WS_MGMT_ENDPOINT = 'https://example.com/_aws/ws';
process.env.USER_POOL_ID = 'us-east-1_TestPool123';
process.env.AWS_REGION = 'us-east-1';

// ---------- Mock AWS SDK v3 clients ----------
vi.mock('@aws-sdk/client-dynamodb', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-dynamodb');
  class MockDynamoDBClient {
    send = ddbSend;
  }
  return { ...actual, DynamoDBClient: MockDynamoDBClient };
});

vi.mock('@aws-sdk/client-apigatewaymanagementapi', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-apigatewaymanagementapi');
  class MockApiGwMgmtClient {
    constructor(_: any) {}
    send = apigwSend;
  }
  return { ...actual, ApiGatewayManagementApiClient: MockApiGwMgmtClient };
});

// ---------- Mock JWT verification (jose library) ----------
const { jwtVerifyMock } = vi.hoisted(() => {
  return {
    jwtVerifyMock: vi.fn(),
  };
});

vi.mock('jose', async () => {
  const actual = await vi.importActual<any>('jose');
  return {
    ...actual,
    jwtVerify: jwtVerifyMock,
    createRemoteJWKSet: vi.fn(() => ({} as any)), // Mock JWKS
  };
});

// ---------- Import after mocks are set up ----------
import { handler } from './handler';
import {
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

// ---------- Helpers ----------
function mkToken(payload: Record<string, unknown>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const header = b64(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

beforeEach(() => {
  ddbSend.mockReset();
  apigwSend.mockReset();
  jwtVerifyMock.mockReset();
  
  // Default mock: verify token and return payload based on token content
  jwtVerifyMock.mockImplementation(async (token: string) => {
    // Extract payload from token (same logic as old decodeJwtNoVerify for tests)
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const payloadB64 = parts[1];
    const pad = '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(payloadB64 + pad, 'base64url').toString('utf-8');
    const payload = JSON.parse(json);
    
    // Return in jose format
    return {
      payload: {
        sub: payload.sub,
        'cognito:groups': payload['cognito:groups'] || [],
        aud: payload.aud,
        exp: payload.exp || Math.floor(Date.now() / 1000) + 3600, // Default 1 hour from now
      },
      protectedHeader: { alg: 'RS256' },
    };
  });
  
  // Default mock: handle blacklist checks automatically
  // The blacklist check happens FIRST in verifyCognitoJWT, so we handle it here
  // Tests can use mockResolvedValueOnce for subsequent calls
  ddbSend.mockImplementation(async (command: any) => {
    // Check if this is a blacklist check by inspecting the command
    if (command instanceof GetItemCommand) {
      // Try to get table name from command - it might be in different places
      const tableName = (command as any).input?.TableName 
        || (command as any).TableName
        || (command.input && command.input.TableName);
      
      if (tableName === 'LocalRevokedTokens' || tableName === process.env.REVOKED_TOKENS_TABLE) {
        // This is a blacklist check - return empty (not revoked)
        return {}; // No Item = not revoked
      }
    }
    // For all other commands, we need to check if there are queued responses
    // Since mockImplementation takes precedence, we'll return empty and let tests override
    // Tests should use mockResolvedValueOnce AFTER the blacklist check
    return {};
  });
});

// ===================================================================
// Happy-path core flow (your original passing tests)
// ===================================================================

describe('$connect', () => {
  it('stores a connection row', async () => {
    // First call: blacklist check (returns empty = not revoked)
    // Second call: PutItemCommand for connection
    ddbSend.mockResolvedValueOnce({}); // Blacklist check - not revoked
    ddbSend.mockResolvedValueOnce({}); // PutItemCommand
    const token = mkToken({ sub: 'u1', 'cognito:groups': ['ADMINS'] });

    const resp = await handler({
      requestContext: { routeKey: '$connect', connectionId: 'C-1' } as any,
      queryStringParameters: { token },
    } as any);

    expect(resp.statusCode).toBe(200);
    expect(ddbSend).toHaveBeenCalled();
    expect(ddbSend.mock.calls[0][0]).toBeInstanceOf(PutItemCommand);
  });
});

describe('register', () => {
  it('claims robot presence for owner', async () => {
    ddbSend.mockResolvedValueOnce({}); // PutItemCommand

    const token = mkToken({ sub: 'owner-1' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'R-1' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({ type: 'register', robotId: 'robot-1' }),
    } as any);

    expect(resp.statusCode).toBe(200);
    expect(ddbSend).toHaveBeenCalled();
    expect(ddbSend.mock.calls[0][0]).toBeInstanceOf(PutItemCommand);
  });
});

describe('offer forwarding', () => {
  it('looks up robot conn and posts to it', async () => {
    // 1) Blacklist check (handled by default mock - returns empty = not revoked)
    // 2) GetItem to find robot connection
    ddbSend.mockResolvedValueOnce({
      Item: { connectionId: { S: 'R-1' } },
    });
    // 3) PostToConnection
    apigwSend.mockResolvedValueOnce({});

    const token = mkToken({ sub: 'owner-1' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-1' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'offer',
        robotId: 'robot-1',
        payload: { type: 'offer', sdp: 'v=0...' },
      }),
    } as any);

    expect(resp.statusCode).toBe(200);
    expect(ddbSend.mock.calls[0][0]).toBeInstanceOf(GetItemCommand);
    expect(apigwSend.mock.calls[0][0]).toBeInstanceOf(PostToConnectionCommand);
  });
});

describe('$disconnect', () => {
  it('deletes connection row', async () => {
    ddbSend.mockResolvedValueOnce({}); // DeleteItemCommand
    const resp = await handler({
      requestContext: { routeKey: '$disconnect', connectionId: 'C-1' } as any,
    } as any);
    expect(resp.statusCode).toBe(200);
    expect(ddbSend.mock.calls[0][0]).toBeInstanceOf(DeleteItemCommand);
  });
});

// ===================================================================
// Extended coverage: errors, admin, ICE, invalid input
// ===================================================================

describe('auth & validation errors', () => {
  it('unauthorized when missing token on $connect', async () => {
    const resp = await handler({
      requestContext: { routeKey: '$connect', connectionId: 'C-2' } as any,
      queryStringParameters: {}, // no token
    } as any);

    expect(resp.statusCode).toBe(401);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it('400 when register missing robotId', async () => {
    const token = mkToken({ sub: 'owner-2' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'R-2' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({ type: 'register' }), // no robotId
    } as any);
    expect(resp.statusCode).toBe(400);
  });

  it('400 on invalid JSON body', async () => {
    const token = mkToken({ sub: 'u2' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-3' } as any,
      queryStringParameters: { token },
      body: '{not-json',
    } as any);
    expect(resp.statusCode).toBe(400);
  });

  it('400 on invalid target', async () => {
    // Simulate robot registered so the test flows to target validation
    ddbSend.mockResolvedValueOnce({ Item: { connectionId: { S: 'R-X' } } });

    const token = mkToken({ sub: 'owner-X' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-X' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'offer',
        robotId: 'robot-X',
        target: 'weird', // invalid
        payload: { x: 1 },
      }),
    } as any);
    expect(resp.statusCode).toBe(400);
  });

  it('400 when target=client but clientConnectionId missing', async () => {
    const token = mkToken({ sub: 'owner-Y' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'R-Y' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'answer',
        robotId: 'robot-Y',
        target: 'client',
        // clientConnectionId omitted
        payload: { type: 'answer', sdp: '...' },
      }),
    } as any);
    expect(resp.statusCode).toBe(400);
  });
});

describe('robot offline & ICE', () => {
  it('404 when robot offline (no presence row)', async () => {
    // GetItem returns no Item
    ddbSend.mockResolvedValueOnce({ Item: undefined });

    const token = mkToken({ sub: 'owner-3' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-4' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'offer',
        robotId: 'robot-missing',
        target: 'robot',
        payload: { type: 'offer', sdp: '...' },
      }),
    } as any);

    expect(resp.statusCode).toBe(404);
    expect(apigwSend).not.toHaveBeenCalled();
  });

  it('forwards ice-candidate to robot like offer/answer', async () => {
    // Robot presence lookup
    ddbSend.mockResolvedValueOnce({ Item: { connectionId: { S: 'R-ice' } } });
    apigwSend.mockResolvedValueOnce({});

    const token = mkToken({ sub: 'owner-4' });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-ice' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'ice-candidate',
        robotId: 'robot-ice',
        target: 'robot',
        payload: { candidate: 'candidate:0 1 UDP 2122252543 192.0.2.3 54400 typ host' },
      }),
    } as any);

    expect(resp.statusCode).toBe(200);
    expect(ddbSend.mock.calls[0][0]).toBeInstanceOf(GetItemCommand);
    expect(apigwSend.mock.calls[0][0]).toBeInstanceOf(PostToConnectionCommand);
  });
});

describe('takeover', () => {
  it('403 for non-owner non-admin', async () => {
    // Presence row showing owner-A
    ddbSend.mockResolvedValueOnce({
      Item: { ownerUserId: { S: 'owner-A' }, connectionId: { S: 'R-TA' } },
    });

    const token = mkToken({ sub: 'user-B' }); // not owner, not admin
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-t1' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({ type: 'takeover', robotId: 'robot-A' }),
    } as any);

    expect(resp.statusCode).toBe(403);
    expect(apigwSend).not.toHaveBeenCalled();
  });

  it('admin can takeover and message robot', async () => {
    // Presence row with some owner & a connectionId
    ddbSend.mockResolvedValueOnce({
      Item: { ownerUserId: { S: 'owner-X' }, connectionId: { S: 'R-TADM' } },
    });
    apigwSend.mockResolvedValueOnce({});

    const token = mkToken({ sub: 'admin-1', 'cognito:groups': ['ADMINS'] });
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-t2' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({ type: 'takeover', robotId: 'robot-A' }),
    } as any);

    expect(resp.statusCode).toBe(200);
    expect(apigwSend).toHaveBeenCalled();
    expect(apigwSend.mock.calls[0][0]).toBeInstanceOf(PostToConnectionCommand);
  });
});

describe('additional edge cases', () => {
  it('returns 401 on $default when token is missing', async () => {
    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-unauth' } as any,
      // no queryStringParameters (no token)
      body: JSON.stringify({ type: 'offer', robotId: 'robot-x' }),
    } as any);

    expect(resp.statusCode).toBe(401);
    expect(resp.body).toContain('Unauthorized');
    expect(ddbSend).not.toHaveBeenCalled();
    expect(apigwSend).not.toHaveBeenCalled();
  });
    it('returns 404 on takeover when robot is offline', async () => {
    // First DynamoDB GetItem returns empty (no presence row)
    ddbSend.mockResolvedValueOnce({});

    const token = mkToken({ sub: 'owner-xyz' });

    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-takeover' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'takeover',
        robotId: 'robot-offline',
      }),
    } as any);

    expect(resp.statusCode).toBe(404);
    expect(resp.body).toContain('robot offline');
    expect(apigwSend).not.toHaveBeenCalled();
  });
  it('forwards offer to specific client when target=client', async () => {
    // No DynamoDB access expected for target=client path
    const token = mkToken({ sub: 'user-1' });

    apigwSend.mockResolvedValueOnce({}); // PostToConnection success

    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-sender' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'offer',
        robotId: 'robot-123',
        target: 'client',
        clientConnectionId: 'C-target',
        payload: { type: 'offer', sdp: 'v=0...' },
      }),
    } as any);

    expect(resp.statusCode).toBe(200);
    expect(apigwSend).toHaveBeenCalledTimes(1);

    const call = apigwSend.mock.calls[0][0];
    // Should be a PostToConnectionCommand
    expect(call).toBeInstanceOf(PostToConnectionCommand);

    // Optional: inspect command input
    const input = call.input;
    expect(input.ConnectionId).toBe('C-target');

    const forwarded = JSON.parse(Buffer.from(input.Data).toString('utf-8'));
    expect(forwarded.type).toBe('offer');
    expect(forwarded.robotId).toBe('robot-123');
    expect(forwarded.payload).toMatchObject({ type: 'offer' });
  });
  it('still returns 200 when PostToConnection fails (e.g. GoneException)', async () => {
    const token = mkToken({ sub: 'owner-1' });

    // 1) DB lookup for robot presence
    ddbSend.mockResolvedValueOnce({
      Item: { connectionId: { S: 'R-1' } },
    });

    // 2) APIGW fails (simulating a closed socket)
    const err = Object.assign(new Error('gone'), { name: 'GoneException' });
    apigwSend.mockRejectedValueOnce(err);

    const resp = await handler({
      requestContext: { routeKey: '$default', connectionId: 'C-1' } as any,
      queryStringParameters: { token },
      body: JSON.stringify({
        type: 'offer',
        robotId: 'robot-err',
        target: 'robot',
        payload: { type: 'offer', sdp: 'v=0...' },
      }),
    } as any);

    // We swallow the error, log it, and still return 200
    expect(resp.statusCode).toBe(200);
    expect(ddbSend).toHaveBeenCalledTimes(1);
    expect(apigwSend).toHaveBeenCalledTimes(1);
  });
});