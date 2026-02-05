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
 * Set to false and implement new protocol support in the branch below.
 */
const LEGACY = true;

// In-memory storage (simulating DynamoDB tables)
const connections = new Map<string, { userId: string; kind: string; groups: string[] }>();
const robotPresence = new Map<string, { connectionId: string; ownerUserId: string; status: string }>();
const wsMap = new Map<string, WebSocket>(); // Map connectionId -> WebSocket

const server = createServer();
const wss = new WebSocketServer({ server, path: '/' });

console.log(`🚀 Mock Signaling Server starting on ws://localhost:${PORT}`);
console.log('=====================================\n');

wss.on('connection', (ws, req) => {
  const url = parse(req.url || '', true);
  const token = url.query.token as string;
  const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Store WebSocket in map for lookup
  (ws as any).connectionId = connectionId;
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

function handleMessage(connectionId: string, msg: any, ws: WebSocket) {
  const conn = connections.get(connectionId);
  if (!conn) return;

  const isNewProtocol = typeof msg.type === 'string' && msg.type.includes('.');
  if (!LEGACY && isNewProtocol) {
    // TODO: Add support for new communication protocol (signalling.*, agent.*)
    console.log(`[${connectionId}] ⚠️  New protocol not yet implemented: ${msg.type}`);
    return;
  }
  if (!LEGACY && !isNewProtocol) {
    console.log(`[${connectionId}] ⚠️  Legacy messages not accepted in new protocol mode`);
    return;
  }

  console.log(`[${connectionId}] 📨 Received: ${msg.type}`, JSON.stringify(msg, null, 2));

  switch (msg.type) {
    case 'register':
      handleRegister(connectionId, msg, conn);
      break;
    
    case 'offer':
    case 'answer':
    case 'ice-candidate':
    case 'candidate':
      handleSignal(connectionId, msg, ws);
      break;
    
    case 'takeover':
      handleTakeover(connectionId, msg, ws);
      break;
    
    default:
      console.log(`[${connectionId}] ⚠️  Unknown message type: ${msg.type}`);
  }
}

function handleRegister(connectionId: string, msg: any, conn: any) {
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

function handleSignal(connectionId: string, msg: any, ws: WebSocket) {
  const robotId = msg.robotId;
  const target = (msg.target || 'robot').toLowerCase();
  const type = msg.type;

  if (!robotId || !type) {
    console.log(`[${connectionId}] ❌ Signal failed: robotId and type required`);
    return;
  }

  let targetConn: WebSocket | undefined;

  if (target === 'robot') {
    // Look up robot's connection
    const presence = robotPresence.get(robotId);
    if (!presence) {
      console.log(`[${connectionId}] ❌ Robot ${robotId} not found/offline`);
      return;
    }

    // Find the robot's WebSocket connection
    targetConn = wsMap.get(presence.connectionId);
    if (!targetConn) {
      console.log(`[${connectionId}] ❌ Robot connection ${presence.connectionId} not found`);
      return;
    }
  } else if (target === 'client') {
    // Client specified by clientConnectionId
    const clientConnId = msg.clientConnectionId;
    if (!clientConnId) {
      console.log(`[${connectionId}] ❌ clientConnectionId required for target=client`);
      return;
    }

    targetConn = wsMap.get(clientConnId);
    if (!targetConn) {
      console.log(`[${connectionId}] ❌ Client connection ${clientConnId} not found`);
      return;
    }
  }

  if (targetConn) {
    // Forward message
    const outbound = {
      type,
      robotId,
      from: connections.get(connectionId)?.userId || connectionId,
      payload: msg.payload || {},
    };

    console.log(`[${connectionId}] 📤 Forwarding ${type} to ${target} (${targetConn.readyState === WebSocket.OPEN ? 'open' : 'closed'})`);
    
    if (targetConn.readyState === WebSocket.OPEN) {
      targetConn.send(JSON.stringify(outbound));
      console.log(`[${connectionId}] ✅ Message forwarded successfully`);
    } else {
      console.log(`[${connectionId}] ❌ Target connection not open`);
    }
  }
}

function handleTakeover(connectionId: string, msg: any, ws: WebSocket) {
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
  console.log(`   Test script: npm run test:websocket <token> robot1`);
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
