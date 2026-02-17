/**
 * Local WebSocket Testing Script
 * 
 * This script simulates multiple WebSocket connections to test:
 * - Robot registration
 * - Client connections
 * - Message forwarding between connections
 * - Delegation/authorization checks
 * 
 * Usage:
 *   npx tsx scripts/test-websocket-local.ts [token] [robotId]
 * 
 * The WebSocket URL is automatically detected from:
 *   1. amplify_outputs.json (custom.signaling.websocketUrl) - if sandbox is running
 *   2. VITE_WS_URL environment variable
 *   3. Local fallback (ws://192.168.132.19:8765)
 * 
 * Examples:
 *   # Auto-detect URL, provide token
 *   npx tsx scripts/test-websocket-local.ts eyJraWQ... robot1
 * 
 *   # Auto-detect URL and use default robotId
 *   npx tsx scripts/test-websocket-local.ts eyJraWQ...
 * 
 *   # Manual override (legacy support)
 *   npx tsx scripts/test-websocket-local.ts wss://abc123.execute-api.us-east-1.amazonaws.com/prod eyJraWQ... robot1
 */

import WebSocket from 'ws';
import { getWebSocketUrl, printWebSocketConfig } from './get-websocket-config';

// Parse arguments - support both new (auto-detect) and legacy (manual) formats
let WS_URL: string;
let TOKEN: string;
let ROBOT_ID: string;

// Check if first arg looks like a URL (starts with ws:// or wss://)
if (process.argv[2]?.startsWith('ws://') || process.argv[2]?.startsWith('wss://')) {
  // Legacy format: <wsUrl> <token> [robotId]
  WS_URL = process.argv[2];
  TOKEN = process.argv[3];
  ROBOT_ID = process.argv[4] || 'robot1';
} else {
  // New format: auto-detect URL, <token> [robotId]
  const config = getWebSocketUrl();
  WS_URL = config.wsUrl;
  TOKEN = process.argv[2];
  ROBOT_ID = process.argv[3] || 'robot1';
}

if (!TOKEN) {
  console.error('❌ Error: JWT token is required');
  console.error('');
  console.error('Usage: npx tsx scripts/test-websocket-local.ts [token] [robotId]');
  console.error('');
  console.error('The WebSocket URL is automatically detected. You only need to provide:');
  console.error('  - token: JWT token from browser (DevTools → Application → Local Storage)');
  console.error('  - robotId: (optional) Robot ID to test with (default: robot1)');
  console.error('');
  console.error('To get your JWT token:');
  console.error('  1. Sign in to your app in the browser');
  console.error('  2. Open DevTools → Application → Local Storage');
  console.error('  3. Look for a key containing "CognitoIdentityServiceProvider" and "idToken"');
  console.error('  4. Copy the token value (starts with eyJ...)');
  console.error('');
  printWebSocketConfig();
  process.exit(1);
}

interface TestMessage {
  type: string;
  robotId?: string;
  target?: string;
  clientConnectionId?: string;
  payload?: any;
  sdp?: string;
  candidate?: any;
}

class WebSocketTester {
  private ws: WebSocket | null = null;
  private connectionId: string | null = null;
  private receivedMessages: any[] = [];
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  connect(url: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${url}?token=${encodeURIComponent(token)}`;
      console.log(`[${this.name}] Connecting to ${wsUrl.replace(token, 'TOKEN')}...`);
      
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log(`[${this.name}] ✅ Connected`);
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error(`[${this.name}] ❌ Connection error:`, error.message);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[${this.name}] 🔌 Disconnected (code: ${code}, reason: ${reason.toString()})`);
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.receivedMessages.push({
            timestamp: new Date().toISOString(),
            message: msg,
          });
          console.log(`[${this.name}] 📨 Received:`, JSON.stringify(msg, null, 2));
        } catch (e) {
          console.log(`[${this.name}] 📨 Received (raw):`, data.toString());
        }
      });
    });
  }

  send(message: TestMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`[${this.name}] ❌ Cannot send: WebSocket not open`);
      return;
    }
    console.log(`[${this.name}] 📤 Sending:`, JSON.stringify(message, null, 2));
    this.ws.send(JSON.stringify(message));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getReceivedMessages(): any[] {
    return this.receivedMessages;
  }

  waitForMessage(type: string, timeout: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        const msg = this.receivedMessages.find(m => m.message.type === type);
        if (msg) {
          clearInterval(checkInterval);
          resolve(msg.message);
          return;
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for message type: ${type}`));
        }
      }, 100);
    });
  }
}

async function runTests() {
  console.log('🧪 Starting WebSocket Local Testing');
  console.log('=====================================\n');
  
  // Print configuration
  printWebSocketConfig();
  console.log(`🤖 Robot ID: ${ROBOT_ID}`);
  console.log(`🔑 Token: ${TOKEN.substring(0, 20)}...${TOKEN.substring(TOKEN.length - 10)}\n`);

  // Create test clients
  const robot = new WebSocketTester('ROBOT');
  const client1 = new WebSocketTester('CLIENT1');
  const client2 = new WebSocketTester('CLIENT2');

  try {
    // Step 1: Connect robot
    console.log('\n📡 Step 1: Robot connecting...');
    await robot.connect(WS_URL, TOKEN);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for connection to stabilize

    // Step 2: Robot registers
    console.log('\n📡 Step 2: Robot registering...');
    robot.send({
      type: 'register',
      robotId: ROBOT_ID,
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Client 1 connects
    console.log('\n📡 Step 3: Client 1 connecting...');
    await client1.connect(WS_URL, TOKEN);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 4: Client 1 sends offer to robot
    console.log('\n📡 Step 4: Client 1 sending offer to robot...');
    client1.send({
      type: 'offer',
      robotId: ROBOT_ID,
      target: 'robot',
      payload: {
        sdp: 'mock-sdp-offer-from-client1',
      },
    });
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 5: Robot sends answer back (use client connectionId from offer the robot received)
    const client1ConnId = await robot.waitForMessage('offer', 3000).then(m => m.from).catch(() => null);
    if (!client1ConnId) {
      console.log('  ⚠️  Could not get client connectionId from offer - answer step may fail');
    }
    console.log('\n📡 Step 5: Robot sending answer to client...');
    robot.send({
      type: 'answer',
      robotId: ROBOT_ID,
      target: 'client',
      clientConnectionId: client1ConnId || 'CLIENT1_CONN_ID',
      payload: {
        sdp: 'mock-sdp-answer-from-robot',
      },
    });
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 6: Client 2 connects (to test delegation)
    console.log('\n📡 Step 6: Client 2 connecting (testing delegation)...');
    await client2.connect(WS_URL, TOKEN);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 7: Client 2 tries to send offer (should work if delegated, fail if not)
    console.log('\n📡 Step 7: Client 2 sending offer (authorization check)...');
    client2.send({
      type: 'offer',
      robotId: ROBOT_ID,
      target: 'robot',
      payload: {
        sdp: 'mock-sdp-offer-from-client2',
      },
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 8: Verify packet forwarding
    console.log('\n📊 Test Summary & Verification');
    console.log('=====================================');
    
    const robotMessages = robot.getReceivedMessages();
    const client1Messages = client1.getReceivedMessages();
    const client2Messages = client2.getReceivedMessages();
    
    console.log(`Robot messages received: ${robotMessages.length}`);
    robotMessages.forEach((msg, i) => {
      console.log(`  ${i + 1}. ${msg.message.type} from ${msg.message.from || 'unknown'}`);
    });
    
    console.log(`\nClient 1 messages received: ${client1Messages.length}`);
    client1Messages.forEach((msg, i) => {
      console.log(`  ${i + 1}. ${msg.message.type} from ${msg.message.from || 'unknown'}`);
    });
    
    console.log(`\nClient 2 messages received: ${client2Messages.length}`);
    client2Messages.forEach((msg, i) => {
      console.log(`  ${i + 1}. ${msg.message.type} from ${msg.message.from || 'unknown'}`);
    });
    
    // Verify packet forwarding
    console.log('\n🔍 Packet Forwarding Verification:');
    const robotReceivedOffer = robotMessages.some(m => m.message.type === 'offer');
    const client1ReceivedAnswer = client1Messages.some(m => m.message.type === 'answer');
    
    if (robotReceivedOffer) {
      console.log('  ✅ Robot received offer from client (forwarding works!)');
    } else {
      console.log('  ⚠️  Robot did not receive offer - check routing');
    }
    
    if (client1ReceivedAnswer) {
      console.log('  ✅ Client 1 received answer from robot (forwarding works!)');
    } else {
      console.log('  ⚠️  Client 1 did not receive answer - check routing');
    }
    
    console.log('\n✅ Test completed!');
    console.log('\n💡 For detailed routing info, check CloudWatch logs for [PACKET_FORWARD] entries');
    console.log('   These show: source → target connection IDs, message types, and robot IDs');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up connections...');
    robot.disconnect();
    client1.disconnect();
    client2.disconnect();
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  }
}

// Run tests
runTests().catch(console.error);

