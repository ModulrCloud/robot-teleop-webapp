# Testing with Mock Signaling Server

## Quick Start

You can test the signaling server locally without AWS infrastructure using the mock server!

### Step 1: Start the Mock Server

In one terminal:
```bash
npm run test:mock-server
```

This starts a WebSocket server on `ws://localhost:8765` that simulates the AWS signaling server.

### Step 2: Run the Test

In another terminal:
```bash
# Get your token first (see below)
npm run test:websocket <your-token> robot1
```

## What the Mock Server Does

The mock server simulates:
- ✅ WebSocket connections with token authentication
- ✅ Robot registration (`register` messages)
- ✅ Message forwarding (offer, answer, ice-candidate)
- ✅ Robot presence tracking (which robots are online)
- ✅ Connection management (connect/disconnect)

## How It Works

1. **Mock Server** (`scripts/mock-signaling-server.ts`):
   - Runs on `ws://localhost:8765`
   - Stores connections and robot presence in memory
   - Forwards messages between connections
   - Logs all activity for debugging

2. **Test Script** (`scripts/test-websocket-local.ts`):
   - Connects to the mock server
   - Simulates robot and client connections
   - Sends test messages
   - Verifies packet forwarding

## Example Session

**Terminal 1 (Mock Server):**
```bash
$ npm run test:mock-server
🚀 Mock Signaling Server starting on ws://localhost:8765
✅ Mock Signaling Server running on ws://localhost:8765

[conn-123] ✅ Connected (user: eyJraWQiOiJ1...)
[conn-123] 📨 Received: register
[conn-123] ✅ Robot robot1 registered
[conn-456] ✅ Connected (user: eyJraWQiOiJ1...)
[conn-123] 📨 Received: offer
[conn-123] 📤 Forwarding offer to robot (open)
[conn-123] ✅ Message forwarded successfully
```

**Terminal 2 (Test Script):**
```bash
$ npm run test:websocket eyJraWQ... robot1
🧪 Starting WebSocket Local Testing
📡 WebSocket Configuration:
   URL: ws://localhost:8765
   Source: local_fallback

[ROBOT] ✅ Connected
[ROBOT] 📤 Sending: {"type":"register","robotId":"robot1"}
[CLIENT1] ✅ Connected
[CLIENT1] 📤 Sending: {"type":"offer","robotId":"robot1",...}
[ROBOT] 📨 Received: {"type":"offer",...}
✅ Robot received offer from client (forwarding works!)
```

## Benefits

- ✅ **No AWS required** - Test locally without sandbox
- ✅ **Fast iteration** - No deployment delays
- ✅ **Full control** - See all messages and routing
- ✅ **Easy debugging** - All logs in one place

## Limitations

The mock server is simplified compared to the real AWS server:
- ❌ No JWT verification (accepts any token)
- ❌ No DynamoDB persistence (in-memory only)
- ❌ No authorization checks (no delegation testing)
- ❌ No CloudWatch logging

For full testing including authorization and delegation, use the real AWS signaling server.

## Switching Between Mock and Real Server

**Use Mock Server:**
```bash
npm run test:mock-server  # Start mock server
npm run test:websocket <token>  # Uses localhost:8765
```

**Use Real AWS Server:**
```bash
npx ampx sandbox  # Start sandbox (generates amplify_outputs.json)
npm run test:websocket <token>  # Auto-detects AWS URL
```

The test script automatically detects which server to use based on what's available!

