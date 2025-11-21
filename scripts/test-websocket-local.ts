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
 *   1. Start your Amplify sandbox: `npx ampx sandbox`
 *   2. Get the WebSocket URL from amplify_outputs.json (custom.signaling.websocketUrl)
 *   3. Get a valid JWT token (you can extract from browser DevTools after signing in)
 *   4. Run: npx tsx scripts/test-websocket-local.ts <wsUrl> <token> <robotId>
 * 
 * Example:
 *   npx tsx scripts/test-websocket-local.ts wss://abc123.execute-api.us-east-1.amazonaws.com/prod eyJraWQ... robot1
 */

import WebSocket from 'ws';

const WS_URL = process.argv[2];
const TOKEN = process.argv[3];
const ROBOT_ID = process.argv[4] || 'robot1';

if (!WS_URL || !TOKEN) {
  console.error('Usage: npx tsx scripts/test-websocket-local.ts <wsUrl> <token> [robotId]');
  console.error('Example: npx tsx scripts/test-websocket-local.ts wss://abc123.execute-api.us-east-1.amazonaws.com/prod eyJraWQ... robot1');
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
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 5: Robot sends answer back
    console.log('\n📡 Step 5: Robot sending answer to client...');
    robot.send({
      type: 'answer',
      robotId: ROBOT_ID,
      target: 'client',
      clientConnectionId: 'CLIENT1_CONN_ID', // In real scenario, this would be the actual connection ID
      payload: {
        sdp: 'mock-sdp-answer-from-robot',
      },
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

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

    // Step 8: Summary
    console.log('\n📊 Test Summary');
    console.log('=====================================');
    console.log(`Robot messages received: ${robot.getReceivedMessages().length}`);
    console.log(`Client 1 messages received: ${client1.getReceivedMessages().length}`);
    console.log(`Client 2 messages received: ${client2.getReceivedMessages().length}`);
    
    console.log('\n✅ Test completed. Check the logs above to verify:');
    console.log('  1. Robot successfully registered');
    console.log('  2. Messages were forwarded between connections');
    console.log('  3. Authorization checks worked correctly');
    console.log('\n💡 Tip: Check CloudWatch logs for [PACKET_FORWARD] entries to verify routing');

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

