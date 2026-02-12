/**
 * Data-channel message format for teleop: envelope (modulr-v0 / interface-spec) vs legacy flat.
 * Used by useWebRTC to send movement and future custom commands over the WebRTC data channel.
 */

export const DATA_CHANNEL_PROTOCOL_VERSION = '0.0';

export type RobotDataChannelProtocol = 'legacy' | 'modulr-v0';

/** Builds an envelope for data-channel messages (type, version, id, timestamp, payload). */
export function buildDataChannelEnvelope(
  messageType: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: messageType,
    version: DATA_CHANNEL_PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload,
  };
}

/** Legacy flat format for robots that registered with type "register". */
export function buildLegacyMovementMessage(
  forward: number,
  turn: number
): Record<string, unknown> {
  return {
    type: 'MovementCommand',
    params: { forward, turn },
  };
}

/** Returns the movement message in the correct format for the given protocol. */
export function getMovementMessage(
  protocol: RobotDataChannelProtocol | null,
  forward: number,
  turn: number
): Record<string, unknown> {
  if (protocol === 'modulr-v0') {
    return buildDataChannelEnvelope('agent.movement', { forward, turn });
  }
  return buildLegacyMovementMessage(forward, turn);
}
