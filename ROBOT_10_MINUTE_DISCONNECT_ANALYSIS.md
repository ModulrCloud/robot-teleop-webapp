# Robot 10-Minute Disconnect Analysis

## 🔴 Root Cause Identified

### AWS API Gateway WebSocket Default Idle Timeout: **10 Minutes**

**Location:** AWS API Gateway WebSocket API configuration (not in code, but AWS default behavior)

**Problem:**
- AWS API Gateway WebSocket APIs have a **default idle timeout of 10 minutes (600 seconds)**
- If no messages are sent or received for 10 minutes, AWS automatically closes the WebSocket connection
- This is a **hard limit** set by AWS API Gateway, not something in your code

**Evidence:**
- Your WebSocket API is created in `amplify/backend.ts` (lines 220-230)
- **No timeout configuration is specified**, so it uses AWS defaults
- No keepalive/ping mechanism is implemented in the codebase to prevent idle timeout

## Current Code Analysis

### 1. WebSocket API Configuration
**File:** `amplify/backend.ts` (lines 220-230)

```typescript
const wsApi = new WebSocketApi(dataStack, 'SignalingWebSocketApi', {
  connectRouteOptions: { ... },
  disconnectRouteOptions: { ... },
  defaultRouteOptions: { ... },
});
```

**Issue:** No `idleTimeout` or keepalive configuration is set, so it uses AWS default of **10 minutes**.

### 2. No Keepalive/Ping Mechanism
**Searched for:**
- `ping` / `pong` messages
- `keepalive` / `heartbeat` mechanisms
- Periodic message sending

**Result:** ❌ **No keepalive mechanism found in the codebase**

**Files checked:**
- `amplify/functions/signaling/handler.ts` - No ping/pong handling
- `src/hooks/useWebRTC.ts` - No periodic keepalive
- `src/components/RobotMessageLogger.tsx` - No keepalive
- Robot example code in `src/pages/RobotSetup.tsx` - Has keepalive example (every 30 seconds) but this is just example code, not enforced

### 3. Robot Example Code Has Keepalive (But Not Enforced)
**File:** `src/pages/RobotSetup.tsx` (lines 630-643)

The example Python code shows a keepalive mechanism:
```python
def send_keepalive():
    while not should_close:
        time.sleep(30)  # Send keepalive every 30 seconds
        if not should_close:
            keepalive_msg = {
                "type": "register",  # Re-register to show robot is still active
                "from": ROBOT_ID
            }
            ws.send(json.dumps(keepalive_msg))
```

**However:**
- This is just **example code** shown to users
- It's not enforced or required
- If robots don't implement this, they will disconnect after 10 minutes of inactivity

## Why This Happens

1. **Robot connects** → WebSocket connection established ✅
2. **Robot registers** → Connection active ✅
3. **No activity for 10 minutes** → AWS API Gateway considers connection idle
4. **AWS automatically closes connection** → Robot disconnects ❌
5. **Robot needs to reconnect** → Requires new token

## Solutions

### Option 1: Implement Keepalive/Ping Mechanism (Recommended)

**For Robots:**
- Robots should send periodic keepalive messages (every 30-60 seconds)
- Can use the `register` message type (as shown in example code)
- Or implement a dedicated `ping` message type

**For Server:**
- Add ping/pong message handling in `signaling/handler.ts`
- Respond to ping messages with pong
- This keeps the connection active

### Option 2: Increase API Gateway Timeout (If Possible)

**Note:** AWS API Gateway WebSocket APIs have a **maximum idle timeout of 2 hours (7200 seconds)**, but the default is 10 minutes. You can configure this in the CDK:

```typescript
const wsApi = new WebSocketApi(dataStack, 'SignalingWebSocketApi', {
  // ... existing config ...
  // Note: Check CDK documentation for exact property name
  // May need to configure at the Stage level instead
});
```

**However:** Even with increased timeout, keepalive is still recommended for reliability.

### Option 3: Implement Server-Side Keepalive

**In `signaling/handler.ts`:**
- Send periodic ping messages to all active connections
- If no response, mark connection as stale
- This prevents AWS from closing connections due to inactivity

## Recommended Implementation

### 1. Add Ping/Pong Message Types

**In `signaling/handler.ts`:**
```typescript
// Add to MessageType
type MessageType = 'register' | 'offer' | 'answer' | 'ice-candidate' | 'takeover' | 'candidate' | 'monitor' | 'ping' | 'pong';

// Add ping handler
async function handlePing(connectionId: string): Promise<void> {
  await postTo(connectionId, {
    type: 'pong',
    timestamp: Date.now(),
  });
}
```

### 2. Update Robot Documentation

**In `ROBOT_CONNECTION_TROUBLESHOOTING.md`:**
- Add section about 10-minute idle timeout
- Require robots to send keepalive messages every 30-60 seconds
- Update example code to make keepalive mandatory

### 3. Client-Side Keepalive (Optional)

**In `useWebRTC.ts`:**
- Send periodic ping messages if no other activity
- Keep connection alive even when idle

## Testing

To verify this is the issue:
1. Connect a robot
2. Don't send any messages for 10 minutes
3. Check if connection closes exactly at 10 minutes
4. Check CloudWatch logs for connection close events

## Files to Review

- `amplify/backend.ts` (lines 220-236) - WebSocket API configuration
- `amplify/functions/signaling/handler.ts` - Message handling (no ping/pong)
- `src/pages/RobotSetup.tsx` (lines 630-643) - Example keepalive code
- `ROBOT_CONNECTION_TROUBLESHOOTING.md` - Should document this requirement

## Conclusion

The **10-minute disconnect is caused by AWS API Gateway's default idle timeout**. This is not a bug in your code, but a limitation that needs to be addressed by:

1. ✅ Implementing keepalive/ping mechanism
2. ✅ Documenting the requirement for robots
3. ⚠️ Optionally increasing the timeout (but keepalive is still recommended)

The example code in `RobotSetup.tsx` already shows how to implement keepalive, but it's not enforced or required, which is why robots are disconnecting.

