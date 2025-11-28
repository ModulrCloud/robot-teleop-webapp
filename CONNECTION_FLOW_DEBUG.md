# Connection Flow Debugging Guide

## What Happens When a User Clicks Connect (or Opens Teleop Page)

### Step 1: Browser Initiates Connection
**Location:** `src/pages/Teleop.tsx` line 147
- `useEffect` automatically calls `connect()` when page loads
- No manual "Connect" button click needed

**Location:** `src/hooks/useWebRTC.ts` line 80
1. Gets JWT token from Cognito
2. Opens WebSocket: `wss://<api-gateway-url>?token=<jwt-token>`
3. On `ws.onopen`:
   - Creates RTCPeerConnection
   - Creates WebRTC offer
   - Sends message: `{ to: robotId, from: 'browser1', type: 'offer', sdp: '<sdp-string>' }`

**What to check:**
- Open browser console (F12)
- Look for WebSocket connection errors
- Check if `ws.onopen` fires (should see WebRTC offer being created)

### Step 2: Signaling Server Receives Message
**Location:** `amplify/functions/signaling/handler.ts` line 1118
- Route: `$default` (for all messages after initial `$connect`)
- Authenticates using connection ID from `ConnectionsTable`

**Location:** `amplify/functions/signaling/handler.ts` line 1279
- Calls `handleSignal()` for offer/answer/candidate messages

**What to check in CloudWatch:**
```
fields @timestamp, @message
| filter @message like /HANDLE_SIGNAL_INPUT/ or @message like /LAMBDA_INVOCATION/
| sort @timestamp desc
| limit 50
```

Look for:
- `[LAMBDA_INVOCATION]` with `route: '$default'`
- `[HANDLE_SIGNAL_INPUT]` with `robotId`, `type: 'offer'`

### Step 3: Server Extracts robotId
**Location:** `amplify/functions/signaling/handler.ts` line 166 (`normalizeMessage`)
- Extracts `robotId` from `to` field: `{ to: "robot-ee3868c8", ... }`
- Sets `msg.robotId = "robot-ee3868c8"`

**What to check:**
- Verify the `robotId` in the URL matches what the robot registered with
- URL: `localhost:5173/teleop?robotId=robot-ee3868c8`
- Robot should register with: `{ type: "register", from: "robot-ee3868c8" }`

### Step 4: Server Looks Up Robot Connection
**Location:** `amplify/functions/signaling/handler.ts` line 986
- Queries `RobotPresenceTable` for `robotId`
- Gets robot's `connectionId` (WebSocket connection ID)

**What to check in CloudWatch:**
```
fields @timestamp, @message
| filter @message like /PACKET_FORWARD/ or @message like /target offline/
| sort @timestamp desc
| limit 50
```

If robot is offline, you'll see:
- `statusCode: 404, body: 'target offline'`

### Step 5: Server Forwards Offer to Robot
**Location:** `amplify/functions/signaling/handler.ts` line 1087
- Uses API Gateway Management API to send message to robot's WebSocket
- Message format: `{ type: 'offer', to: 'robot-ee3868c8', from: '<browser-connection-id>', sdp: '...' }`

**What to check:**
- `[PACKET_FORWARD_SUCCESS]` in CloudWatch
- Robot's Python script should receive: `"Received: { ... }"`

### Step 6: Robot Receives and Responds
**Location:** Python test script `on_message()` handler
- Should see: `"→ ✅ Received offer from <connection-id>"`
- Should send: `{ type: 'answer', from: 'robot-ee3868c8', to: '<connection-id>', sdp: '...' }`

**What to check:**
- Python script console output
- Should see offer received and answer sent

---

## Common Issues and Solutions

### Issue 1: Robot Not Receiving Offers
**Symptoms:**
- Python script shows keepalive messages but no offers
- Browser console shows no errors
- CloudWatch shows `[HANDLE_SIGNAL_INPUT]` but no `[PACKET_FORWARD_SUCCESS]`

**Possible Causes:**
1. **Robot not registered:**
   - Check CloudWatch for `[REGISTER_SUCCESS]`
   - Verify robotId matches: URL `?robotId=robot-ee3868c8` vs robot registration `from: "robot-ee3868c8"`

2. **robotId mismatch:**
   - Browser sends: `{ to: "robot-ee3868c8" }`
   - Robot registered as: `{ from: "robot-ee3868c8" }`
   - These must match exactly!

3. **Robot offline:**
   - Check `RobotPresenceTable` in DynamoDB
   - Robot's connection may have expired (TTL)

**Solution:**
- Verify robot is running and registered
- Check robotId in URL matches robot's registration
- Check CloudWatch logs for `[REGISTER_SUCCESS]` and `[PACKET_FORWARD]`

### Issue 2: Browser Not Sending Offers
**Symptoms:**
- Browser console shows WebSocket connected but no offer sent
- CloudWatch shows no `[HANDLE_SIGNAL_INPUT]` for offers

**Possible Causes:**
1. **WebSocket not opening:**
   - Check browser console for WebSocket errors
   - Verify JWT token is valid

2. **WebRTC offer creation failing:**
   - Check browser console for RTCPeerConnection errors
   - May need to allow camera/microphone permissions

**Solution:**
- Check browser console (F12) for errors
- Verify WebSocket URL is correct
- Check if `ws.onopen` fires in `useWebRTC.ts`

### Issue 3: Message Format Mismatch
**Symptoms:**
- Messages reach robot but format is wrong
- Robot can't parse the message

**Solution:**
- Browser sends: `{ to: robotId, from: 'browser1', type: 'offer', sdp: '...' }`
- Server forwards: `{ type: 'offer', to: robotId, from: '<connection-id>', sdp: '...' }`
- Robot should handle both formats

---

## Debugging Checklist

1. **Is the robot running?**
   - Check Python script is running
   - Should see: `"Robot <robotId> registered"`
   - Should see keepalive every 30 seconds

2. **Is the robot registered?**
   - Check CloudWatch: `[REGISTER_SUCCESS]`
   - Check DynamoDB `RobotPresenceTable` for robotId

3. **Is the browser connecting?**
   - Check browser console (F12)
   - Should see WebSocket connection
   - Should see WebRTC offer being created

4. **Is the offer reaching the server?**
   - Check CloudWatch: `[LAMBDA_INVOCATION]` with `route: '$default'`
   - Check CloudWatch: `[HANDLE_SIGNAL_INPUT]` with `type: 'offer'`

5. **Is the server finding the robot?**
   - Check CloudWatch: `[PACKET_FORWARD]` or `target offline`
   - If `target offline`, robot isn't registered or robotId mismatch

6. **Is the robot receiving the offer?**
   - Check Python script console
   - Should see: `"→ ✅ Received offer from <connection-id>"`

---

## Quick Test Commands

### Check if robot is registered (CloudWatch):
```
fields @timestamp, @message
| filter @message like /REGISTER_SUCCESS/ or @message like /REGISTER_ATTEMPT/
| sort @timestamp desc
| limit 20
```

### Check if offers are being sent (CloudWatch):
```
fields @timestamp, @message
| filter @message like /HANDLE_SIGNAL_INPUT/ and @message like /offer/
| sort @timestamp desc
| limit 20
```

### Check if robot is found (CloudWatch):
```
fields @timestamp, @message
| filter @message like /PACKET_FORWARD/ or @message like /target offline/
| sort @timestamp desc
| limit 20
```

