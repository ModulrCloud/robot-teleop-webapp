/**
 * Mock Signaling Server for Local Testing
 * 
 * This simulates the AWS WebSocket API Gateway + Lambda signaling server
 * for local testing without needing AWS infrastructure.
 * 
 * Usage:
 *   npx tsx scripts/mock-signaling-server.ts [port]
 * 
 * Default port: 8765
 */

import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { parse } from 'url';

const PORT = parseInt(process.argv[2] || '8765', 10);

/**
 * Protocol mode: when true, use legacy message format (type: "register", "offer", etc.).
 * When false, use new Modulr Interface Spec protocol (type: "signalling.register", etc.).
 */
const LEGACY = process.env.MOCK_LEGACY !== 'false'; // default true; set MOCK_LEGACY=false for new protocol

const SUPPORTED_VERSIONS = ['0.0', '0.1'];

// In-memory storage (simulating DynamoDB tables)
const connections = new Map<string, { userId: string; kind: string; groups: string[] }>();
const connectionProtocol = new Map<string, 'legacy' | 'modulr-v0'>();
const robotPresence = new Map<string, { connectionId: string; ownerUserId: string; status: string }>();
const wsMap = new Map<string, WebSocket>(); // Map connectionId -> WebSocket

const server = createServer();
const wss = new WebSocketServer({ server, path: '/' });

console.log(`🚀 Mock Signaling Server starting on ws://localhost:${PORT}`);
console.log(`   Protocol mode: ${LEGACY ? 'LEGACY' : 'NEW (Modulr Interface Spec)'}`);
console.log('=====================================\n');

wss.on('connection', (ws, req) => {
  const url = parse(req.url || '', true);
  const token = url.query.token as string;
  const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  wsMap.set(connectionId, ws);
  
  // Simple token validation (in real server, this would verify JWT)
  if (!token) {
    console.log(`[${connectionId}] ❌ Rejected: No token provided`);
    ws.close(1008, 'No token provided');
    wsMap.delete(connectionId);
    return;
  }

  // Extract user info from token (simplified - in real server, decode JWT)
  // For testing, we'll just use the token as the userId
  const userId = token.substring(0, 20); // Simplified user ID extraction
  
  console.log(`[${connectionId}] ✅ Connected (user: ${userId.substring(0, 10)}...)`);
  
  // Store connection
  connections.set(connectionId, {
    userId,
    kind: 'client', // Will be updated to 'robot' if they register
    groups: [],
  });

  // Handle messages
  ws.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(connectionId, msg, ws);
    } catch (error) {
      console.error(`[${connectionId}] ❌ Invalid JSON:`, error);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log(`[${connectionId}] 🔌 Disconnected`);
    
    // Clean up
    connections.delete(connectionId);
    connectionProtocol.delete(connectionId);
    wsMap.delete(connectionId);
    
    // Remove from robot presence if it was a robot
    for (const [robotId, presence] of robotPresence.entries()) {
      if (presence.connectionId === connectionId) {
        robotPresence.delete(robotId);
        console.log(`[${connectionId}] 🗑️  Removed robot ${robotId} from presence`);
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`[${connectionId}] ❌ Error:`, error.message);
  });
});

type NormalizedMsg = { type: string; robotId?: string; target?: 'robot' | 'client'; clientConnectionId?: string; payload?: Record<string, unknown> };

function normalizeNewProtocol(msg: Record<string, unknown>): NormalizedMsg | null {
  if (!msg || typeof msg.type !== 'string' || !msg.type.includes('.')) return null;
  const p = (msg.payload && typeof msg.payload === 'object') ? msg.payload as Record<string, unknown> : {};
  const t = String(msg.type).toLowerCase();
  switch (t) {
    case 'signalling.register': {
      const agentId = typeof p.agentId === 'string' ? p.agentId.trim() : undefined;
      return { type: 'register', robotId: agentId, payload: p };
    }
    case 'signalling.offer': {
      const robotId = [p.robotId, p.agentId, msg.robotId].find((x): x is string => typeof x === 'string' && x.trim().length > 0)?.trim();
      const connectionId = typeof p.connectionId === 'string' ? p.connectionId.trim() : undefined;
      return { type: 'offer', robotId, target: 'robot', clientConnectionId: connectionId, payload: { sdp: p.sdp, sdpType: p.sdpType ?? 'offer' } };
    }
    case 'signalling.answer': {
      const robotId = [p.robotId, p.agentId].find((x): x is string => typeof x === 'string' && x.trim().length > 0)?.trim();
      const connectionId = typeof p.connectionId === 'string' ? p.connectionId.trim() : undefined;
      return { type: 'answer', robotId, target: 'client', clientConnectionId: connectionId, payload: { sdp: p.sdp, sdpType: p.sdpType ?? 'answer' } };
    }
    case 'signalling.ice_candidate': {
      const robotId = [p.robotId, p.agentId].find((x): x is string => typeof x === 'string' && x.trim().length > 0)?.trim();
      const connectionId = typeof p.connectionId === 'string' ? p.connectionId.trim() : undefined;
      return { type: 'ice-candidate', robotId, clientConnectionId: connectionId, payload: { candidate: p.candidate, sdpMid: p.sdpMid, sdpMLineIndex: p.sdpMLineIndex } };
    }
    case 'agent.ping':
    case 'agent.pong':
      return { type: t };
    case 'signalling.capabilities':
      return { type: 'signalling.capabilities' };
    default:
      return null;
  }
}

function formatOutbound(msg: NormalizedMsg & { to?: string; from?: string; sdp?: string; candidate?: string }, destProtocol: 'legacy' | 'modulr-v0' | undefined, version = '0.0'): Record<string, unknown> {
  if (destProtocol !== 'modulr-v0') {
    return msg as Record<string, unknown>;
  }
  const envelope: Record<string, unknown> = { type: msg.type, version, id: `mock-${Date.now()}`, timestamp: new Date().toISOString(), payload: {} };
  if (msg.type === 'offer') {
    envelope.type = 'signalling.offer';
    (envelope.payload as Record<string, unknown>).sdp = (msg.payload as Record<string, unknown>)?.sdp;
    (envelope.payload as Record<string, unknown>).sdpType = 'offer';
    (envelope.payload as Record<string, unknown>).connectionId = msg.from;
  } else if (msg.type === 'answer') {
    envelope.type = 'signalling.answer';
    (envelope.payload as Record<string, unknown>).sdp = (msg.payload as Record<string, unknown>)?.sdp;
    (envelope.payload as Record<string, unknown>).sdpType = 'answer';
    (envelope.payload as Record<string, unknown>).connectionId = msg.to;
  } else if (msg.type === 'candidate' || msg.type === 'ice-candidate') {
    envelope.type = 'signalling.ice_candidate';
    (envelope.payload as Record<string, unknown>).candidate = (msg.payload as Record<string, unknown>)?.candidate ?? msg.candidate;
    (envelope.payload as Record<string, unknown>).connectionId = msg.clientConnectionId ?? msg.to ?? msg.from;
  }
  return envelope;
}

function sendTo(connId: string, data: Record<string, unknown>): void {
  const ws = wsMap.get(connId);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function handleMessage(connectionId: string, msg: Record<string, unknown>, ws: WebSocket) {
  const conn = connections.get(connectionId);
  if (!conn) return;

  const isNewProtocol = typeof msg.type === 'string' && msg.type.includes('.');
  if (!LEGACY && !isNewProtocol) {
    console.log(`[${connectionId}] ⚠️  Legacy messages not accepted in new protocol mode`);
    return;
  }

  // Detect and persist protocol on first message
  if (!connectionProtocol.has(connectionId)) {
    connectionProtocol.set(connectionId, isNewProtocol ? 'modulr-v0' : 'legacy');
  }

  let normalized: NormalizedMsg | Record<string, unknown> = msg;
  if (isNewProtocol) {
    const n = normalizeNewProtocol(msg);
    if (!n) {
      console.log(`[${connectionId}] ⚠️  Unknown new-protocol type: ${msg.type}`);
      return;
    }
    normalized = n;
  }

  const type = (normalized as NormalizedMsg).type;
  console.log(`[${connectionId}] 📨 Received: ${type}`, JSON.stringify(normalized, null, 2));

  if (type === 'signalling.capabilities') {
    const destProto = connectionProtocol.get(connectionId);
    const response = destProto === 'modulr-v0'
      ? { type: 'signalling.capabilities', version: '0.0', id: `cap-${Date.now()}`, timestamp: new Date().toISOString(), payload: { supportedVersions: SUPPORTED_VERSIONS } }
      : { type: 'signalling.capabilities', supportedVersions: SUPPORTED_VERSIONS };
    sendTo(connectionId, response);
    return;
  }

  if (type === 'agent.ping') {
    const pingId = (msg.id ?? msg.timestamp ?? Date.now()) as string;
    const response = connectionProtocol.get(connectionId) === 'modulr-v0'
      ? { type: 'agent.pong', version: '0.0', id: `${pingId}-pong`, timestamp: new Date().toISOString(), correlationId: pingId }
      : { type: 'agent.pong', id: `${pingId}-pong`, correlationId: pingId };
    sendTo(connectionId, response);
    return;
  }

  if (type === 'agent.pong') {
    return; // ack only, no response needed
  }

  switch (type) {
    case 'register':
      handleRegister(connectionId, normalized as NormalizedMsg, conn);
      break;

    case 'offer':
    case 'answer':
    case 'ice-candidate':
    case 'candidate':
      handleSignal(connectionId, normalized as NormalizedMsg, ws);
      break;

    case 'takeover':
      handleTakeover(connectionId, normalized as NormalizedMsg, ws);
      break;

    default:
      console.log(`[${connectionId}] ⚠️  Unknown message type: ${type}`);
  }
}

function handleRegister(connectionId: string, msg: NormalizedMsg, conn: { userId: string; kind: string; groups: string[] }) {
  const robotId = msg.robotId;
  if (!robotId) {
    console.log(`[${connectionId}] ❌ Register failed: robotId required`);
    return;
  }

  // Update connection kind
  conn.kind = 'robot';
  
  // Store robot presence
  robotPresence.set(robotId, {
    connectionId,
    ownerUserId: conn.userId,
    status: 'online',
  });

  console.log(`[${connectionId}] ✅ Robot ${robotId} registered`);
}

function handleSignal(connectionId: string, msg: NormalizedMsg, _ws: WebSocket) {
  const robotId = msg.robotId;
  const target = (msg.target || 'robot').toLowerCase();
  const type = msg.type;

  if (!robotId || !type) {
    console.log(`[${connectionId}] ❌ Signal failed: robotId and type required`);
    return;
  }

  let targetConnId: string | undefined;

  if (target === 'robot') {
    const presence = robotPresence.get(robotId);
    if (!presence) {
      console.log(`[${connectionId}] ❌ Robot ${robotId} not found/offline`);
      return;
    }
    targetConnId = presence.connectionId;
  } else if (target === 'client') {
    const clientConnId = msg.clientConnectionId;
    if (!clientConnId) {
      console.log(`[${connectionId}] ❌ clientConnectionId required for target=client`);
      return;
    }
    targetConnId = clientConnId;
  }

  if (!targetConnId) return;

  const targetConn = wsMap.get(targetConnId);
  if (!targetConn || targetConn.readyState !== WebSocket.OPEN) {
    console.log(`[${connectionId}] ❌ Target connection ${targetConnId} not found or not open`);
    return;
  }

  const destProtocol = connectionProtocol.get(targetConnId);
  const fromConnId = connectionId;
  const clientConnId = msg.clientConnectionId ?? (target === 'client' ? targetConnId : fromConnId);

  const baseMsg: NormalizedMsg & { from?: string; to?: string; candidate?: string } = {
    type,
    robotId,
    from: fromConnId,
    to: targetConnId,
    clientConnectionId: clientConnId,
    payload: msg.payload || {},
  };

  const outbound = formatOutbound(baseMsg, destProtocol);

  console.log(`[${connectionId}] 📤 Forwarding ${type} to ${target} (${targetConnId})`);
  targetConn.send(JSON.stringify(outbound));
  console.log(`[${connectionId}] ✅ Message forwarded successfully`);
}

function handleTakeover(connectionId: string, msg: NormalizedMsg & { robotId?: string }, _ws: WebSocket) {
  const robotId = msg.robotId;
  if (!robotId) {
    console.log(`[${connectionId}] ❌ Takeover failed: robotId required`);
    return;
  }

  const presence = robotPresence.get(robotId);
  if (!presence) {
    console.log(`[${connectionId}] ❌ Robot ${robotId} not found`);
    return;
  }

  const robotConn = wsMap.get(presence.connectionId);
  if (robotConn && robotConn.readyState === WebSocket.OPEN) {
    robotConn.send(JSON.stringify({
      type: 'admin-takeover',
      robotId,
      by: connections.get(connectionId)?.userId || connectionId,
    }));
    console.log(`[${connectionId}] ✅ Takeover message sent to robot`);
  }
}

server.listen(PORT, () => {
  console.log(`✅ Mock Signaling Server running on ws://localhost:${PORT}`);
  console.log(`\n📝 Usage:`);
  console.log(`   Legacy test:  npm run test:websocket ws://localhost:${PORT} <token> robot1`);
  console.log(`   New-protocol: MOCK_LEGACY=false npm run test:mock-server (port ${PORT}); npm run test:websocket:new-protocol ws://localhost:${PORT}`);
  console.log(`   Or set: export VITE_WS_URL=ws://localhost:${PORT}`);
  console.log(`\n🛑 Press Ctrl+C to stop\n`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down mock server...');
  wss.close(() => {
    server.close(() => {
      console.log('✅ Server stopped');
      process.exit(0);
    });
  });
});
