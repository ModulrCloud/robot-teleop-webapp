/**
 * New-protocol (Modulr Interface Spec) WebSocket test
 *
 * Run with mock server in new-protocol mode:
 *   Terminal 1: MOCK_LEGACY=false npx tsx scripts/mock-signaling-server.ts
 *   Terminal 2: npx tsx scripts/test-websocket-new-protocol.ts ws://localhost:8765
 */

import WebSocket from 'ws';

const WS_URL = process.argv[2] || 'ws://localhost:8765';
const TOKEN = process.argv[3] || 'test-token';
const ROBOT_ID = 'robot1';

interface Envelope {
  type: string;
  version?: string;
  id?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

function envelope(type: string, payload: Record<string, unknown> = {}): Envelope {
  return { type, version: '0.0', id: `test-${Date.now()}`, timestamp: new Date().toISOString(), payload };
}

async function main() {
  console.log('🧪 New-protocol (Modulr Interface Spec) test');
  console.log('==========================================\n');
  console.log(`   URL: ${WS_URL}`);
  console.log(`   Robot: ${ROBOT_ID}\n`);

  const robotMsgs: Envelope[] = [];
  const clientMsgs: Envelope[] = [];

  const connect = (name: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(TOKEN)}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  };

  const onMessage = (ws: WebSocket, arr: Envelope[], name: string) => {
    ws.on('message', (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString()) as Envelope;
      arr.push(msg);
      console.log(`[${name}] 📨 ${msg.type}`);
    });
  };

  try {
    // 1. Robot connects and registers
    const robotWs = await connect('ROBOT');
    onMessage(robotWs, robotMsgs, 'ROBOT');
    robotWs.send(JSON.stringify(envelope('signalling.register', { agentId: ROBOT_ID })));
    await sleep(500);

    // 2. Client connects
    const clientWs = await connect('CLIENT');
    onMessage(clientWs, clientMsgs, 'CLIENT');
    await sleep(500);

    // 3. Client sends offer (need robot's connectionId from... we don't have it; mock uses robotId for lookup)
    // For offer, payload needs: sdp, connectionId (client's id - server assigns it, we don't know yet)
    // The mock normalizes and forwards by robotId. Client sends connectionId in payload - but we don't have it.
    // In new protocol, the client would know their connectionId from a "ready" or similar. Mock doesn't send that.
    // Workaround: send offer with empty connectionId; mock may still forward. Let me check mock logic.
    // Actually for signalling.offer from client: payload.connectionId is optional in some flows. The mock extracts
    // connectionId from payload.connectionId - if missing, it might fail. Let me check.
    // In normalizeNewProtocol for signalling.offer: connectionId = p.connectionId. If undefined, clientConnectionId is undefined.
    // handleSignal for target=robot doesn't need clientConnectionId - it uses robotId to find the robot. So offer
    // from client to robot should work without connectionId. The mock will add fromConnId when forwarding.
    clientWs.send(JSON.stringify(envelope('signalling.offer', {
      robotId: ROBOT_ID,
      sdp: 'mock-sdp-offer',
      sdpType: 'offer',
    })));
    await sleep(1000);

    // Wait for robot to receive offer (includes client connectionId in payload)
    const offerForRobot = robotMsgs.find(m => m.type === 'signalling.offer' || m.type === 'offer');
    const clientConnId = (offerForRobot?.payload as Record<string, unknown>)?.connectionId as string | undefined;
    if (!clientConnId) {
      console.log('  ⚠️  No client connectionId in offer payload');
    }

    // 4. Robot sends answer (connectionId tells server which client to route to)
    robotWs.send(JSON.stringify(envelope('signalling.answer', {
      robotId: ROBOT_ID,
      connectionId: clientConnId,
      sdp: 'mock-sdp-answer',
      sdpType: 'answer',
    })));
    await sleep(800);

    // 5. Client sends ICE candidate to robot
    clientWs.send(JSON.stringify(envelope('signalling.ice_candidate', {
      robotId: ROBOT_ID,
      candidate: 'mock-candidate-from-client',
    })));
    await sleep(500);

    // 6. Robot sends ICE candidate to client (connectionId only - no explicit target; server infers from source)
    robotWs.send(JSON.stringify(envelope('signalling.ice_candidate', {
      connectionId: clientConnId,
      candidate: 'mock-candidate-from-robot',
    })));
    await sleep(500);

    // 7. Test signalling.capabilities
    clientWs.send(JSON.stringify(envelope('signalling.capabilities', {})));
    await sleep(400);

    // 8. Test agent.ping
    clientWs.send(JSON.stringify({ type: 'agent.ping', version: '0.0', id: 'ping-1', timestamp: new Date().toISOString() }));
    await sleep(400);

    // Summary
    const gotCapabilities = clientMsgs.some(m => m.type === 'signalling.capabilities');
    const gotPong = clientMsgs.some(m => m.type === 'agent.pong');
    const gotAnswer = clientMsgs.some(m => m.type === 'signalling.answer' || m.type === 'answer');
    const gotOffer = robotMsgs.some(m => m.type === 'signalling.offer' || m.type === 'offer');
    const gotRobotIce = robotMsgs.some(m => m.type === 'signalling.ice_candidate' || m.type === 'ice-candidate');
    const gotClientIce = clientMsgs.some(m => m.type === 'signalling.ice_candidate' || m.type === 'ice-candidate');

    console.log('\n📊 Results');
    console.log('==========');
    console.log(`  Robot received offer: ${gotOffer ? '✅' : '❌'}`);
    console.log(`  Client received answer: ${gotAnswer ? '✅' : '❌'}`);
    console.log(`  Robot received ICE from client: ${gotRobotIce ? '✅' : '❌'}`);
    console.log(`  Client received ICE from robot: ${gotClientIce ? '✅' : '❌'}`);
    console.log(`  signalling.capabilities response: ${gotCapabilities ? '✅' : '❌'}`);
    console.log(`  agent.ping → agent.pong: ${gotPong ? '✅' : '❌'}`);
    const ok = gotOffer && gotAnswer && gotRobotIce && gotClientIce && gotCapabilities && gotPong;
    console.log(`\n${ok ? '✅ New-protocol test passed' : '⚠️  Some checks failed'}\n`);

    robotWs.close();
    clientWs.close();
  } catch (err) {
    console.error('❌', err);
  } finally {
    await sleep(500);
    process.exit(0);
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

main();
