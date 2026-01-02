# Connection Architecture - Understanding the 10-Minute Timeout

## Three Separate Connections

### 1. **Client ↔ AWS WebSocket** (Signaling Only)
- **Purpose:** WebRTC signaling (offers, answers, ICE candidates)
- **When active:** During WebRTC connection establishment
- **After WebRTC established:** Mostly idle (only occasional ICE candidates)
- **Location:** `src/hooks/useWebRTC.ts` - Client connects to AWS WebSocket

### 2. **Robot ↔ AWS WebSocket** (Signaling Only)
- **Purpose:** WebRTC signaling (offers, answers, ICE candidates)
- **When active:** During WebRTC connection establishment
- **After WebRTC established:** Mostly idle (only occasional ICE candidates)
- **Location:** Robot connects to AWS WebSocket (via connection URL from Robot Setup page)

### 3. **Client ↔ Robot** (Direct WebRTC - Peer-to-Peer)
- **Purpose:** Actual data transfer (commands, video stream)
- **When active:** Continuously during active session
- **How it works:** Direct peer-to-peer connection, NOT through AWS
- **Location:** `src/hooks/useWebRTC.ts` - `sendCommand()` uses `RTCDataChannel`

## The Problem: Which Connection Goes Idle?

### ❌ NOT the Client ↔ Robot Connection
- This is the **WebRTC peer-to-peer connection**
- Commands go directly from client to robot via `RTCDataChannel`
- This connection is **NOT** affected by AWS API Gateway timeout
- If you're sending commands, this connection stays active

### ✅ YES - The Robot ↔ AWS WebSocket Connection
- This is the **signaling WebSocket connection**
- Used ONLY for WebRTC signaling (offers, answers, ICE candidates)
- **After WebRTC is established, this connection becomes mostly idle**
- If no signaling messages for 10 minutes → AWS closes it
- Robot can't receive new offers or send answers → Needs to reconnect

### ✅ ALSO - The Client ↔ AWS WebSocket Connection
- Same issue - mostly idle after WebRTC is established
- But client might send occasional messages (like session updates)
- Less likely to timeout, but still possible

## Why This Happens

### During Active Session:
1. **WebRTC connection established** ✅
   - Client sends offer via WebSocket → AWS → Robot
   - Robot sends answer via WebSocket → AWS → Client
   - ICE candidates exchanged via WebSocket
   - **WebRTC peer-to-peer connection established**

2. **Commands flow via WebRTC** ✅
   - Client sends commands via `RTCDataChannel` (direct to robot)
   - Robot receives commands via WebRTC (direct from client)
   - **No WebSocket messages needed** - commands bypass AWS

3. **WebSocket connections become idle** ⚠️
   - No signaling messages being sent
   - Only occasional ICE candidates (if connection needs renegotiation)
   - **Robot's WebSocket to AWS has no activity for 10 minutes**

4. **AWS closes idle WebSocket** ❌
   - AWS API Gateway detects 10 minutes of inactivity
   - Closes the robot's WebSocket connection
   - Robot can no longer receive signaling messages

5. **Robot needs to reconnect** 🔄
   - Robot's WebSocket connection is closed
   - Can't receive new offers or send answers
   - Must reconnect with a new token

## Code Evidence

### Client Sends Commands (NOT via WebSocket)
**File:** `src/hooks/useWebRTC.ts` (lines 433-443)
```typescript
const sendCommand = useCallback((linearX: number, angularZ: number) => {
  if (!rosBridgeRef.current) return;
  
  rosBridgeRef.current.send({
    type: "MovementCommand",
    params: {
      "forward": linearX,
      "turn": angularZ,
    }
  });
}, []);
```

**This uses `RTCDataChannel` (WebRTC), NOT WebSocket!**

### WebSocket Only Used for Signaling
**File:** `src/hooks/useWebRTC.ts` (lines 337-348, 383-396)
```typescript
// ICE candidates sent via WebSocket (signaling)
pc.onicecandidate = (event) => {
  if (event.candidate && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'candidate',
      from: myIdRef.current,
      to: robotId,
      candidate: event.candidate,
    }));
  }
};

// Offer sent via WebSocket (signaling)
ws.send(JSON.stringify(offerMessage));
```

**WebSocket is ONLY used for WebRTC signaling, not for commands!**

## The Solution

Since the **Robot ↔ AWS WebSocket** connection goes idle after WebRTC is established, the robot needs to send periodic keepalive messages to keep the WebSocket connection alive.

### Keepalive Messages
- Send every 30-60 seconds
- Can use `register` message type (as shown in example code)
- Keeps the WebSocket connection active
- Prevents AWS from closing it due to idle timeout

## Summary

- **Client ↔ Robot (WebRTC):** Active during session, NOT affected by timeout ✅
- **Robot ↔ AWS (WebSocket):** Idle after WebRTC established, TIMEOUTS after 10 minutes ❌
- **Client ↔ AWS (WebSocket):** Mostly idle, but less likely to timeout (may have occasional activity)

**The problem is the Robot's WebSocket connection to AWS going idle, not the client-robot WebRTC connection!**

