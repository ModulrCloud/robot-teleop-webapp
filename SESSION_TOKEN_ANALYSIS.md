# Session Token Analysis - Robot Connection Issues

## Problem Summary

You're experiencing issues where robots need to generate new session tokens, potentially due to:
1. Token expiration happening faster than expected
2. Client-robot session disconnection causing token invalidation
3. Token expiration during active WebSocket connections

## Key Findings

### 1. ⚠️ Token Expiration Configuration Issue

**Location:** `amplify/backend.ts` (lines 107-133)

**Problem:**
- Code comments indicate tokens should be set to **4 hours (240 minutes)**
- However, the actual configuration is **commented out** and disabled:
  ```typescript
  // NOTE: Token expiration overrides are temporarily disabled due to CloudFormation update issues.
  // These properties may need to be configured via AWS Console or during initial User Pool Client creation.
  ```

**Current State:**
- Token expiration is likely using **Cognito defaults** (typically **1 hour / 60 minutes**)
- This means tokens expire in **1 hour**, not 4 hours as intended

**Impact:**
- If robots run sessions longer than 1 hour, their tokens will expire
- The WebSocket connection might remain open, but token validation will fail
- Robot will need a new token to reconnect

### 2. 🔴 No Token Refresh Mechanism for Robots

**Location:** `src/pages/RobotSetup.tsx`, `src/hooks/useWebRTC.ts`

**Problem:**
- Robots receive a **static token** in the WebSocket URL when they first connect
- This token is embedded in the connection URL: `wss://...?token=<JWT_TOKEN>`
- **No mechanism exists to refresh the token** during an active WebSocket connection
- Once the token expires, the robot cannot continue using the connection

**Client vs Robot Behavior:**
- **Client (web app):** Uses `fetchAuthSession()` which automatically refreshes tokens via Amplify
- **Robot:** Uses a static token from the initial connection URL - no refresh capability

**Code Evidence:**
```typescript
// RobotSetup.tsx - Token is fetched once and embedded in URL
const session = await fetchAuthSession();
token = session.tokens?.idToken?.toString();
const urlWithToken = `${wsUrl}?token=${encodeURIComponent(token)}`;
```

### 3. ⚠️ Token Verification Only on Connection

**Location:** `amplify/functions/signaling/handler.ts` (line 1069)

**Problem:**
- Token is verified **only during initial WebSocket connection** (`onConnect`)
- Token is **NOT re-verified** during the connection lifecycle
- If token expires while connection is active, the connection remains open but becomes invalid

**Current Flow:**
1. Robot connects with token → Token verified ✅
2. Connection established → Token stored in connection table
3. Token expires (after 1 hour) → Connection still open, but token invalid ❌
4. Robot tries to send messages → May fail silently or connection may be terminated

### 4. 🔴 Stale Connection Cleanup Timing

**Location:** `amplify/functions/cleanup-stale-connections/handler.ts` (line 13)

**Problem:**
- Stale connection cleanup runs for connections **older than 1 hour**
- This matches the default token expiration (1 hour)
- If tokens expire at 1 hour, cleanup may terminate connections right when tokens expire

**Code:**
```typescript
const STALE_CONNECTION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
```

**Impact:**
- Connections may be cleaned up at the same time tokens expire
- This could cause robots to lose connection exactly at the 1-hour mark

### 5. ⚠️ Client Session Disconnection Affects Robot

**Location:** `amplify/functions/signaling/handler.ts` (line 1118)

**Problem:**
- When client disconnects, `endConnectionSessions()` is called
- This ends all active sessions for that connection
- If client's WebSocket disconnects (e.g., browser refresh, network issue), robot's session is also ended

**Code:**
```typescript
async function onDisconnect(event: APIGatewayProxyEvent) {
    const connectionId = event.requestContext.connectionId!;
    await endConnectionSessions(connectionId); // Ends all sessions for this connection
    // ...
}
```

**Impact:**
- Client disconnection (intentional or accidental) terminates robot sessions
- Robot may need to reconnect with a new token

## Root Cause Analysis

### Most Likely Scenario:

1. **Token expires after 1 hour** (default Cognito, not 4 hours as intended)
2. **Robot connection remains open** but token becomes invalid
3. **When robot tries to communicate** or server validates connection, token check fails
4. **Connection may be terminated** or robot cannot send/receive messages
5. **Robot needs new token** to reconnect

### Secondary Scenario:

1. **Client disconnects** (browser refresh, network issue, etc.)
2. **Server ends all sessions** for that connection
3. **Robot loses active session** even though its WebSocket might still be open
4. **Robot needs to reconnect** with a new token

## Recommendations

### Immediate Fixes:

1. **Verify and Set Token Expiration to 4 Hours**
   - Go to AWS Cognito Console
   - Navigate to your User Pool → App integration → App clients
   - Edit the app client
   - Set **Access token expiration: 240 minutes (4 hours)**
   - Set **ID token expiration: 240 minutes (4 hours)**
   - This matches your intended configuration

2. **Monitor Token Expiration in Logs**
   - Add logging to track when tokens are about to expire
   - Log token expiration time when connections are established
   - This will help identify if tokens are expiring faster than expected

### Long-term Solutions:

1. **Implement Token Refresh for Robots**
   - Add a mechanism for robots to request token refresh
   - Send refresh token to robot via WebSocket message
   - Robot can update its connection URL or re-authenticate

2. **Periodic Token Validation**
   - Periodically re-validate tokens during active connections
   - If token is about to expire, proactively refresh or notify robot

3. **Separate Client and Robot Sessions**
   - Decouple client disconnection from robot session termination
   - Allow robot sessions to persist independently of client connections

4. **Token Expiration Warnings**
   - Send warnings to robots when tokens are about to expire (e.g., 10 minutes before)
   - Allow robots to proactively refresh before expiration

## Testing Recommendations

1. **Check Actual Token Expiration:**
   - Decode a JWT token and check the `exp` field
   - Calculate time until expiration
   - Verify if it's 1 hour or 4 hours

2. **Monitor Connection Duration:**
   - Track how long robot connections last before needing new tokens
   - Compare to token expiration time

3. **Test Client Disconnection:**
   - Disconnect client while robot is connected
   - Verify if robot session is terminated
   - Check if robot needs new token to reconnect

4. **Test Long-Running Sessions:**
   - Run a robot session for > 1 hour
   - Monitor if token expiration causes issues
   - Check if connection fails at the 1-hour mark

## Files to Review

- `amplify/backend.ts` - Token expiration configuration (lines 107-133)
- `amplify/functions/signaling/handler.ts` - Token verification (line 1069, 129-171)
- `amplify/functions/cleanup-stale-connections/handler.ts` - Cleanup timing (line 13)
- `src/pages/RobotSetup.tsx` - Token generation for robots (lines 71-90)
- `src/hooks/useWebRTC.ts` - Client token usage (lines 152-164)

## Conclusion

The most likely cause of your issue is that **tokens are expiring after 1 hour** (default Cognito) instead of the intended 4 hours, combined with **no token refresh mechanism for robots**. When tokens expire during active connections, robots lose their ability to communicate and need new tokens.

**Priority Actions:**
1. ✅ Verify actual token expiration time in AWS Console
2. ✅ Set token expiration to 4 hours if not already set
3. ⚠️ Monitor connection duration vs token expiration
4. 🔄 Consider implementing token refresh for long-running robot sessions

