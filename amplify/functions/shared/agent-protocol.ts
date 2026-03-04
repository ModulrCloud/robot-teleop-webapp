import { randomUUID } from 'crypto';

const PROTOCOL_VERSION = '0.0';

/**
 * Builds a signaling.ping message (signaling keepalive/liveness).
 */
export function buildSignalingPingMessage(): { type: string; version: string; id: string; timestamp: string } {
  return {
    type: 'signaling.ping',
    version: PROTOCOL_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}
