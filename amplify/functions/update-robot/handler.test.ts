import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import type { Context } from 'aws-lambda';
import { handler, decodeAndValidateEd25519PublicKey } from './handler';

const { ddbSend } = vi.hoisted(() => ({ ddbSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-dynamodb')>('@aws-sdk/client-dynamodb');
  class MockDynamoDBClient {
    send = ddbSend;
  }
  return {
    ...actual,
    DynamoDBClient: MockDynamoDBClient,
  };
});

const ROBOT_TABLE = 'RobotTable';
const PARTNER_TABLE = 'PartnerTable';
const ROBOT_ID = 'robot-uuid-123';
const PARTNER_ID = 'partner-uuid-456';

/** Minimal event for updateRobotLambda; cast via unknown so partial shape is accepted by strict AppSync type. */
function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    arguments: {
      robotId: ROBOT_ID,
      robotName: 'Test Robot',
      description: 'Desc',
      ...overrides,
    },
    identity: {
      username: 'partner-user',
      groups: [],
    },
  } as unknown as Parameters<typeof handler>[0];
}

const noOpContext = {} as Context;
const noOpCallback = (): void => {};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ROBOT_TABLE_NAME = ROBOT_TABLE;
  process.env.PARTNER_TABLE_NAME = PARTNER_TABLE;
});

describe('decodeAndValidateEd25519PublicKey', () => {
  it('accepts 32-byte key as hex (64 hex chars)', () => {
    const hex = '0'.repeat(64);
    const buf = decodeAndValidateEd25519PublicKey(hex);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it('accepts real-world 64-char Ed25519 hex key', () => {
    // Ed25519 public key is exactly 64 hex chars (32 bytes). Source often has 65 (extra newline/char).
    const hex65FromFile = 'd75a980182b10ab7d54bfed3c964073a0ee172f3dafe6238af95b81041052f2b8';
    const hex64 = hex65FromFile.slice(0, 64);
    expect(hex64).toHaveLength(64);
    const buf = decodeAndValidateEd25519PublicKey(hex64);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it('rejects 65 hex characters (off-by-one)', () => {
    const hex64 = 'd75a980182b10ab7d54bfed3c964073a0ee172f3dafe6238af95b81041052f2b8'.slice(0, 64);
    const hex65 = hex64 + '0';
    expect(hex65).toHaveLength(65);
    expect(() => decodeAndValidateEd25519PublicKey(hex65)).toThrow(/expected 32 bytes|Invalid Ed25519|base64/);
  });

  it('accepts 32-byte key as base64', () => {
    const b64 = Buffer.alloc(32, 1).toString('base64');
    const buf = decodeAndValidateEd25519PublicKey(b64);
    expect(buf.length).toBe(32);
  });

  it('throws on empty string', () => {
    expect(() => decodeAndValidateEd25519PublicKey('')).toThrow('cannot be empty');
    expect(() => decodeAndValidateEd25519PublicKey('   ')).toThrow('cannot be empty');
  });

  it('throws when decoded length is not 32', () => {
    const shortHex = '00'.repeat(16);
    expect(() => decodeAndValidateEd25519PublicKey(shortHex)).toThrow('expected 32 bytes');
    const longHex = '00'.repeat(33);
    expect(() => decodeAndValidateEd25519PublicKey(longHex)).toThrow('expected 32 bytes');
  });

  it('throws on invalid base64', () => {
    expect(() => decodeAndValidateEd25519PublicKey('not-valid-base64!!!')).toThrow();
  });

  it('rejects base64 with invalid characters even if Node would decode to 32 bytes', () => {
    const valid32ByteB64 = Buffer.alloc(32, 0).toString('base64');
    expect(() => decodeAndValidateEd25519PublicKey(valid32ByteB64 + '!')).toThrow();
    expect(() => decodeAndValidateEd25519PublicKey(valid32ByteB64 + '@')).toThrow();
  });
});

describe('handler', () => {
  it('persists valid publicKey when provided', async () => {
    const validHexKey = 'a'.repeat(64);
    ddbSend
      .mockResolvedValueOnce({
        Item: {
          id: { S: ROBOT_ID },
          partnerId: { S: PARTNER_ID },
          name: { S: 'Robot' },
          robotId: { S: 'robot-xxxxxxxx' },
        },
      })
      .mockResolvedValueOnce({
        Items: [{ id: { S: PARTNER_ID }, cognitoUsername: { S: 'partner-user' } }],
      })
      .mockResolvedValueOnce({});

    await handler(makeEvent({ publicKey: validHexKey }), noOpContext, noOpCallback);

    expect(ddbSend).toHaveBeenCalledTimes(3);
    const updateCall = ddbSend.mock.calls[2][0];
    expect(updateCall).toBeInstanceOf(UpdateItemCommand);
    const input = (updateCall as UpdateItemCommand).input;
    expect(input.TableName).toBe(ROBOT_TABLE);
    expect(input.Key?.id?.S).toBe(ROBOT_ID);
    expect(input.UpdateExpression).toContain('#publicKey = :publicKey');
    expect(input.ExpressionAttributeValues?.[':publicKey']?.S).toBe(validHexKey);
  });

  it('removes publicKey when null is passed', async () => {
    ddbSend
      .mockResolvedValueOnce({
        Item: {
          id: { S: ROBOT_ID },
          partnerId: { S: PARTNER_ID },
          name: { S: 'Robot' },
          robotId: { S: 'robot-xxxxxxxx' },
          publicKey: { S: 'existing-key' },
        },
      })
      .mockResolvedValueOnce({
        Items: [{ id: { S: PARTNER_ID }, cognitoUsername: { S: 'partner-user' } }],
      })
      .mockResolvedValueOnce({});

    await handler(makeEvent({ publicKey: null }), noOpContext, noOpCallback);

    expect(ddbSend).toHaveBeenCalledTimes(3);
    const updateCall = ddbSend.mock.calls[2][0];
    const input = (updateCall as UpdateItemCommand).input;
    expect(input.UpdateExpression).toMatch(/REMOVE.*#publicKey/);
  });

  it('throws and does not call UpdateItem when publicKey is invalid', async () => {
    ddbSend
      .mockResolvedValueOnce({
        Item: {
          id: { S: ROBOT_ID },
          partnerId: { S: PARTNER_ID },
          name: { S: 'Robot' },
          robotId: { S: 'robot-xxxxxxxx' },
        },
      })
      .mockResolvedValueOnce({
        Items: [{ id: { S: PARTNER_ID }, cognitoUsername: { S: 'partner-user' } }],
      });

    await expect(handler(makeEvent({ publicKey: 'too-short-hex' }), noOpContext, noOpCallback)).rejects.toThrow(/expected 32 bytes|Invalid Ed25519/);

    expect(ddbSend).toHaveBeenCalledTimes(2);
    const lastCall = ddbSend.mock.calls[1][0];
    expect(lastCall).toBeInstanceOf(QueryCommand);
  });

  it('rejects publicKey with spaces (client must send normalized value from normalizePublicKeyForSubmit)', async () => {
    const hex64WithSpace = 'a'.repeat(32) + ' ' + 'a'.repeat(32);
    ddbSend
      .mockResolvedValueOnce({
        Item: {
          id: { S: ROBOT_ID },
          partnerId: { S: PARTNER_ID },
          name: { S: 'Robot' },
          robotId: { S: 'robot-xxxxxxxx' },
        },
      })
      .mockResolvedValueOnce({
        Items: [{ id: { S: PARTNER_ID }, cognitoUsername: { S: 'partner-user' } }],
      });

    await expect(handler(makeEvent({ publicKey: hex64WithSpace }), noOpContext, noOpCallback)).rejects.toThrow(/Invalid Ed25519|base64/);

    expect(ddbSend).toHaveBeenCalledTimes(2);
    expect(ddbSend.mock.calls[1][0]).toBeInstanceOf(QueryCommand);
  });
});
