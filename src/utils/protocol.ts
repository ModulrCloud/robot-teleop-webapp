const PROTOCOL_VERSION = '0.0';

export type SignallingMessageType =
  | 'signalling.offer'
  | 'signalling.answer'
  | 'signalling.ice_candidate'
  | 'signalling.connected'
  | 'signalling.disconnected'
  | 'signalling.capabilities'
  | 'signalling.error';

export type AgentMessageType =
  | 'agent.movement'
  | 'agent.ping'
  | 'agent.pong'
  | 'agent.capabilities'
  | 'agent.error';

export type MessageType = SignallingMessageType | AgentMessageType;

export interface ProtocolEnvelope<T = unknown> {
  type: MessageType;
  version: string;
  id: string;
  timestamp: string;
  payload?: T;
  correlationId?: string;
  meta?: Record<string, unknown>;
}

export interface SignallingOfferPayload {
  connectionId: string;
  sdpType: 'offer';
  sdp: string;
  iceRestart?: boolean;
}

export interface SignallingAnswerPayload {
  connectionId: string;
  sdpType: 'answer';
  sdp: string;
}

export interface SignallingIceCandidatePayload {
  connectionId: string;
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
  usernameFragment?: string;
}

export interface SignallingConnectedPayload {
  connectionId: string;
  iceConnectionState: 'connected' | 'completed';
  dataChannelState?: 'open';
}

export interface SignallingDisconnectedPayload {
  connectionId: string;
  reason: 'closed' | 'failed' | 'timeout';
  iceConnectionState?: string;
  details?: Record<string, unknown>;
}

export interface SignallingCapabilitiesPayload {
  versions: string[];
}

export interface SignallingErrorPayload {
  code:
    | 'INVALID_MESSAGE'
    | 'UNSUPPORTED_VERSION'
    | 'VALIDATION_FAILED'
    | 'INVALID_PAYLOAD'
    | 'UNSUPPORTED_MESSAGE_TYPE'
    | 'CONNECTION_FAILED'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'TIMEOUT'
    | 'CAPABILITY_MISMATCH'
    | 'ICE_FAILED'
    | 'SDP_INVALID'
    | 'INTERNAL_ERROR';
  message: string;
  details?: Record<string, unknown>;
}

export interface AgentMovementPayload {
  forward: number;
  turn: number;
}

export interface AgentCapabilitiesPayload {
  versions: string[];
}

export interface AgentErrorPayload {
  code:
    | 'INVALID_MESSAGE'
    | 'UNSUPPORTED_VERSION'
    | 'VALIDATION_FAILED'
    | 'INVALID_PAYLOAD'
    | 'UNSUPPORTED_MESSAGE_TYPE'
    | 'MOVEMENT_FAILED'
    | 'AGENT_UNAVAILABLE'
    | 'CAPABILITY_MISMATCH'
    | 'INTERNAL_ERROR';
  message: string;
  details?: Record<string, unknown>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function createEnvelope<T>(
  type: MessageType,
  payload?: T,
  correlationId?: string,
  meta?: Record<string, unknown>
): ProtocolEnvelope<T> {
  const envelope: ProtocolEnvelope<T> = {
    type,
    version: PROTOCOL_VERSION,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };
  if (payload !== undefined) envelope.payload = payload;
  if (correlationId) envelope.correlationId = correlationId;
  if (meta) envelope.meta = meta;
  return envelope;
}

export const signalling = {
  offer(connectionId: string, sdp: string, iceRestart?: boolean): ProtocolEnvelope<SignallingOfferPayload> {
    return createEnvelope('signalling.offer', {
      connectionId,
      sdpType: 'offer',
      sdp,
      ...(iceRestart !== undefined && { iceRestart }),
    });
  },

  answer(connectionId: string, sdp: string): ProtocolEnvelope<SignallingAnswerPayload> {
    return createEnvelope('signalling.answer', {
      connectionId,
      sdpType: 'answer',
      sdp,
    });
  },

  iceCandidate(
    connectionId: string,
    candidate: RTCIceCandidate
  ): ProtocolEnvelope<SignallingIceCandidatePayload> {
    return createEnvelope('signalling.ice_candidate', {
      connectionId,
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid || '0',
      sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
      ...(candidate.usernameFragment && { usernameFragment: candidate.usernameFragment }),
    });
  },

  connected(
    connectionId: string,
    iceConnectionState: 'connected' | 'completed',
    dataChannelState?: 'open'
  ): ProtocolEnvelope<SignallingConnectedPayload> {
    return createEnvelope('signalling.connected', {
      connectionId,
      iceConnectionState,
      ...(dataChannelState && { dataChannelState }),
    });
  },

  disconnected(
    connectionId: string,
    reason: 'closed' | 'failed' | 'timeout',
    iceConnectionState?: string,
    details?: Record<string, unknown>
  ): ProtocolEnvelope<SignallingDisconnectedPayload> {
    return createEnvelope('signalling.disconnected', {
      connectionId,
      reason,
      ...(iceConnectionState && { iceConnectionState }),
      ...(details && { details }),
    });
  },

  capabilities(versions: string[] = [PROTOCOL_VERSION]): ProtocolEnvelope<SignallingCapabilitiesPayload> {
    return createEnvelope('signalling.capabilities', { versions });
  },

  error(
    code: SignallingErrorPayload['code'],
    message: string,
    details?: Record<string, unknown>
  ): ProtocolEnvelope<SignallingErrorPayload> {
    return createEnvelope('signalling.error', {
      code,
      message,
      ...(details && { details }),
    });
  },
};

export const agent = {
  movement(forward: number, turn: number): ProtocolEnvelope<AgentMovementPayload> {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return createEnvelope('agent.movement', {
      forward: clamp(forward),
      turn: clamp(turn),
    });
  },

  ping(): ProtocolEnvelope<undefined> {
    return createEnvelope('agent.ping');
  },

  pong(correlationId: string): ProtocolEnvelope<undefined> {
    return createEnvelope('agent.pong', undefined, correlationId);
  },

  capabilities(versions: string[] = [PROTOCOL_VERSION]): ProtocolEnvelope<AgentCapabilitiesPayload> {
    return createEnvelope('agent.capabilities', { versions });
  },

  error(
    code: AgentErrorPayload['code'],
    message: string,
    details?: Record<string, unknown>
  ): ProtocolEnvelope<AgentErrorPayload> {
    return createEnvelope('agent.error', {
      code,
      message,
      ...(details && { details }),
    });
  },
};

export function isSignallingMessage(msg: ProtocolEnvelope): boolean {
  return msg.type.startsWith('signalling.');
}

export function isAgentMessage(msg: ProtocolEnvelope): boolean {
  return msg.type.startsWith('agent.');
}

export function parseMessage(data: string): ProtocolEnvelope | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.type && parsed.version && parsed.id && parsed.timestamp) {
      return parsed as ProtocolEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}
