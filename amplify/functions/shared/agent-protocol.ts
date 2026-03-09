import { randomUUID } from 'crypto';

const PROTOCOL_VERSION = '0.0';

/**
 * Builds a signalling.ping message (signalling keepalive/liveness).
 */
export function buildSignallingPingMessage(): { type: string; version: string; id: string; timestamp: string } {
  return {
    type: 'signalling.ping',
    version: PROTOCOL_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}
