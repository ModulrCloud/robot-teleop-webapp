# Robot Connection Troubleshooting Guide

## Common Issues When Robots Can't Connect

### Issue: Robot is "waiting for connection" indefinitely

This usually means one of the following:

#### 1. **Wrong Robot ID Format** ⚠️ MOST COMMON
The Robot Setup page shows the **correct** `robotId` (format: `robot-XXXXXXXX`), but your agent might be using the wrong ID.

**What to check:**
- The Robot Setup page displays the `robotId` field (e.g., `robot-12345678`)
- This is **NOT** the same as the Robot.id (UUID like `f26c35d0-4872-4529-8287-95486766ba4c`)
- Your agent must use the `robotId` shown on the Robot Setup page

**Solution:**
- Copy the Robot ID from the Robot Setup page (Step 1)
- Ensure your agent configuration uses this exact value
- The registration message must use this `robotId`:
  ```json
  {
    "type": "register",
    "robotId": "robot-12345678"
  }
  ```

#### 2. **Token Expired or Invalid**
The JWT token in the WebSocket URL expires after 4 hours.

**What to check:**
- Token expiration: 4 hours (240 minutes)
- If token expires, robot connection will be rejected with `401 Unauthorized`

**Solution:**
- Go to the Robot Setup page and copy a fresh connection URL
- The page automatically generates a new token when you visit it
- Update your robot's configuration with the new URL

#### 3. **WebSocket Connection Not Established**
The robot might not be connecting to the WebSocket server.

**What to check:**
- Verify the WebSocket URL is correct (from `amplify_outputs.json`)
- Check network connectivity (firewall, VPN, etc.)
- Ensure the URL includes the token: `wss://...?token=...`

**Solution:**
- Test the WebSocket URL in a browser console or WebSocket client
- Verify the Amplify sandbox is running
- Check CloudWatch logs for connection attempts

#### 4. **Registration Message Not Sent**
The robot connects but doesn't send the registration message.

**What to check:**
- Robot must send registration message immediately after WebSocket connection
- Message format must be correct:
  ```json
  {
    "type": "register",
    "robotId": "robot-12345678"
  }
  ```

**Solution:**
- Ensure your agent sends the registration message right after `onopen` event
- Check that the message is valid JSON
- Verify the `robotId` matches exactly (case-sensitive)

#### 5. **Robot Already Registered by Another Owner**
If the robot was previously registered by a different user, registration will fail.

**What to check:**
- Error message: `409 Robot is already registered by another owner`
- Only the original owner or admins can register the robot

**Solution:**
- Have an admin force-claim the robot, OR
- Wait for the previous connection to disconnect (robot goes offline)

## Connection Flow

1. **Robot connects to WebSocket URL** (with token in query string)
   - URL format: `wss://...execute-api...amazonaws.com/prod?token=JWT_TOKEN`
   - Server verifies token and establishes connection

2. **Robot sends registration message**
   ```json
   {
     "type": "register",
     "robotId": "robot-12345678"
   }
   ```

3. **Server registers robot in ROBOT_PRESENCE_TABLE**
   - Stores: `robotId`, `ownerUserId`, `connectionId`, `status: 'online'`

4. **Robot is now online and ready for sessions**

## Debugging Steps

### 1. Check CloudWatch Logs
Look for:
- `$connect` events (connection attempts)
- `register` message handling
- Any error messages (401, 400, 409, 500)

### 2. Verify Robot ID
- Go to Robot Setup page
- Copy the Robot ID shown (should be `robot-XXXXXXXX` format)
- Compare with what your agent is using

### 3. Test WebSocket Connection
Use a WebSocket client to test:
```javascript
const ws = new WebSocket('wss://YOUR_WS_URL?token=YOUR_TOKEN');
ws.onopen = () => {
  console.log('Connected!');
  ws.send(JSON.stringify({
    type: 'register',
    robotId: 'robot-12345678'
  }));
};
ws.onmessage = (msg) => console.log('Received:', msg.data);
ws.onerror = (err) => console.error('Error:', err);
```

### 4. Check Token Validity
- Token expires after 4 hours
- Get a fresh token from Robot Setup page
- Verify token is included in WebSocket URL query string

## Required Configuration for Robots

Your robot agent needs:
1. **WebSocket Connection URL** (with token)
   - Format: `wss://{api-id}.execute-api.{region}.amazonaws.com/prod?token={JWT_TOKEN}`
   - Get from Robot Setup page

2. **Robot ID**
   - Format: `robot-XXXXXXXX` (8 hex characters)
   - Get from Robot Setup page
   - **NOT** the UUID (Robot.id)

3. **Registration Message**
   - Must be sent immediately after WebSocket connection
   - Format: `{"type": "register", "robotId": "robot-XXXXXXXX"}`

## Common Configuration Mistakes

❌ **Wrong:** Using Robot.id (UUID) instead of robotId
```json
{"type": "register", "robotId": "f26c35d0-4872-4529-8287-95486766ba4c"}  // WRONG!
```

✅ **Correct:** Using robotId field
```json
{"type": "register", "robotId": "robot-12345678"}  // CORRECT!
```

❌ **Wrong:** Missing token in WebSocket URL
```
wss://...amazonaws.com/prod  // WRONG - no token!
```

✅ **Correct:** Token included in query string
```
wss://...amazonaws.com/prod?token=eyJhbGc...  // CORRECT!
```

❌ **Wrong:** Registration message sent before connection is open
```javascript
const ws = new WebSocket(url);
ws.send(registerMessage);  // WRONG - connection not open yet!
```

✅ **Correct:** Send after connection opens
```javascript
const ws = new WebSocket(url);
ws.onopen = () => {
  ws.send(registerMessage);  // CORRECT!
};
```

