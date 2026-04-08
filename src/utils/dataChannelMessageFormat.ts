/**
 * Data-channel message format for teleop: envelope (ctrlr-v0 / interface-spec) vs legacy flat.
 * Used by useWebRTC to send movement and future custom commands over the WebRTC data channel.
 */

export const DATA_CHANNEL_PROTOCOL_VERSION = '0.0';
export const LOCATION_PROTOCOL_VERSION = '0.1';
export const NAVIGATION_PROTOCOL_VERSION = '0.4';
export const CONFIG_PROTOCOL_VERSION = '0.5';

export type RobotDataChannelProtocol = 'legacy' | 'modulr-v0';

/** Builds an envelope for data-channel messages (type, version, id, timestamp, payload). */
export function buildDataChannelEnvelope(
  messageType: string,
  payload: Record<string, unknown>,
  version: string = DATA_CHANNEL_PROTOCOL_VERSION
): Record<string, unknown> {
  return {
    type: messageType,
    version,
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

// ---------------------------------------------------------------------------
// Location messages (v0.1)
// ---------------------------------------------------------------------------

export function buildLocationCreateMessage(
  name: string,
  position: { x: number; y: number; z?: number },
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  return buildDataChannelEnvelope(
    'agent.location.create',
    { name, position, ...(metadata && { metadata }) },
    LOCATION_PROTOCOL_VERSION,
  );
}

// ---------------------------------------------------------------------------
// Navigation messages (v0.4)
// ---------------------------------------------------------------------------

export function buildNavigationStartMessage(locationName: string): Record<string, unknown> {
  return buildDataChannelEnvelope(
    'agent.navigation.start',
    { name: locationName },
    NAVIGATION_PROTOCOL_VERSION,
  );
}

export function buildNavigationCancelMessage(): Record<string, unknown> {
  return buildDataChannelEnvelope(
    'agent.navigation.cancel',
    {},
    NAVIGATION_PROTOCOL_VERSION,
  );
}

export type NavigationStatus = 'started' | 'completed' | 'cancelled' | 'failed';

export interface NavigationResponsePayload {
  status: NavigationStatus;
  name: string;
  message?: string;
}

export interface AgentErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Config update messages (v0.5)
// ---------------------------------------------------------------------------

export function buildConfigUpdateMessage(
  key: string,
  value: unknown,
): Record<string, unknown> {
  const id = crypto.randomUUID();
  return {
    type: 'agent.config.update',
    version: CONFIG_PROTOCOL_VERSION,
    id,
    correlationId: id,
    timestamp: new Date().toISOString(),
    payload: { key, value },
  };
}

export interface ConfigUpdateResponsePayload {
  key: string;
  applied: boolean;
  restartRequired: boolean;
}
