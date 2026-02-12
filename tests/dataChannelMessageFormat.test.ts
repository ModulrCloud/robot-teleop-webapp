import { describe, it, expect } from 'vitest';
import {
  buildDataChannelEnvelope,
  buildLegacyMovementMessage,
  getMovementMessage,
  DATA_CHANNEL_PROTOCOL_VERSION,
} from '../src/utils/dataChannelMessageFormat';

describe('buildDataChannelEnvelope', () => {
  it('includes type, version, id, timestamp, and payload', () => {
    const msg = buildDataChannelEnvelope('agent.movement', { forward: 0.5, turn: -0.3 });
    expect(msg.type).toBe('agent.movement');
    expect(msg.version).toBe(DATA_CHANNEL_PROTOCOL_VERSION);
    expect(msg.version).toBe('0.0');
    expect(typeof msg.id).toBe('string');
    expect((msg.id as string).length).toBeGreaterThan(0);
    expect(typeof msg.timestamp).toBe('string');
    expect(msg.payload).toEqual({ forward: 0.5, turn: -0.3 });
  });

  it('produces valid UUID for id', () => {
    const msg = buildDataChannelEnvelope('agent.ping', {});
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect((msg.id as string).match(uuidRe)).toBeTruthy();
  });

  it('produces ISO timestamp', () => {
    const msg = buildDataChannelEnvelope('agent.movement', { forward: 0, turn: 0 });
    expect(() => new Date(msg.timestamp as string).toISOString()).not.toThrow();
    expect((msg.timestamp as string).slice(-1)).toBe('Z');
  });
});

describe('buildLegacyMovementMessage', () => {
  it('returns flat format with type MovementCommand and params', () => {
    const msg = buildLegacyMovementMessage(0.5, -0.3);
    expect(msg).toEqual({
      type: 'MovementCommand',
      params: { forward: 0.5, turn: -0.3 },
    });
  });

  it('handles zero values', () => {
    const msg = buildLegacyMovementMessage(0, 0);
    expect(msg.params).toEqual({ forward: 0, turn: 0 });
  });
});

describe('getMovementMessage', () => {
  it('returns envelope format when protocol is modulr-v0', () => {
    const msg = getMovementMessage('modulr-v0', 0.2, 0.1);
    expect(msg.type).toBe('agent.movement');
    expect(msg.version).toBe('0.0');
    expect(msg.payload).toEqual({ forward: 0.2, turn: 0.1 });
    expect(msg).toHaveProperty('id');
    expect(msg).toHaveProperty('timestamp');
  });

  it('returns legacy format when protocol is legacy', () => {
    const msg = getMovementMessage('legacy', 0.5, -0.3);
    expect(msg).toEqual({
      type: 'MovementCommand',
      params: { forward: 0.5, turn: -0.3 },
    });
  });

  it('returns legacy format when protocol is null (default for unknown)', () => {
    const msg = getMovementMessage(null, 0, 0);
    expect(msg.type).toBe('MovementCommand');
    expect(msg.params).toEqual({ forward: 0, turn: 0 });
  });
});
