# Local WebSocket Testing Guide

This guide explains how to test the WebSocket signaling server locally, including packet forwarding verification and delegation testing.

## Prerequisites

1. **Amplify Sandbox Running**: Start your Amplify sandbox
   ```bash
   npx ampx sandbox
   ```

2. **Get WebSocket URL**: After sandbox starts, check `amplify_outputs.json`:
   ```json
   {
     "custom": {
       "signaling": {
         "websocketUrl": "wss://abc123.execute-api.us-east-1.amazonaws.com/prod"
       }
     }
   }
   ```

3. **Get JWT Token**: 
   - Sign in to your app in the browser
   - Open DevTools → Application → Local Storage
   - Look for a key containing `CognitoIdentityServiceProvider` and `idToken`
   - Copy the token value (it's a long string starting with `eyJ...`)

## Running the Test Script

The test script simulates multiple WebSocket connections to verify:
- ✅ Robot registration
- ✅ Client connections  
- ✅ Message forwarding between connections
- ✅ Authorization/delegation checks

### Basic Usage

```bash
npx tsx scripts/test-websocket-local.ts <wsUrl> <token> [robotId]
```

### Example

```bash
npx tsx scripts/test-websocket-local.ts \
  wss://abc123.execute-api.us-east-1.amazonaws.com/prod \
  eyJraWQiOiJcL1VzZXJQb29sXC8... \
  robot1
```

## What the Test Does

1. **Robot Connection**: Connects as a robot and registers with `robotId`
2. **Client 1 Connection**: Connects as a client and sends an offer to the robot
3. **Robot Response**: Robot sends an answer back to client
4. **Client 2 Connection**: Connects as a second client (tests delegation)
5. **Authorization Check**: Client 2 attempts to send offer (verifies delegation works)

## Verifying Packet Forwarding

### In CloudWatch Logs

After running the test, check CloudWatch logs for the Lambda function. Look for entries like:

```
[PACKET_FORWARD] {
  "timestamp": "2024-01-15T10:30:00.000Z",
  "sourceConnectionId": "abc123",
  "targetConnectionId": "def456",
  "messageType": "offer",
  "robotId": "robot1",
  "fromUserId": "user-123",
  "target": "robot"
}
[PACKET_FORWARD_SUCCESS] {
  "targetConnectionId": "def456",
  "messageType": "offer"
}
```

### What to Look For

✅ **Success Indicators**:
- `[PACKET_FORWARD]` entries show correct source → target routing
- `[PACKET_FORWARD_SUCCESS]` confirms delivery
- Messages appear in both sender and receiver logs

❌ **Failure Indicators**:
- `[PACKET_FORWARD_ERROR]` entries
- Messages sent but not received
- Connection ID mismatches

## Testing Delegation

### Setting Up Delegation

Before testing delegation, you need to add an operator:

1. **Via GraphQL Mutation** (in your app or GraphQL playground):
   ```graphql
   mutation AddOperator {
     manageRobotOperatorLambda(
       robotId: "robot1"
       operatorUserId: "user-456"  # The sub (user ID) of the delegated user
       operatorUsername: "operator-name"
       action: "add"
     ) {
       statusCode
       body
     }
   }
   ```

2. **Verify in DynamoDB**: Check the `RobotOperatorTable` to confirm the delegation was created

### Testing Delegated Access

1. Run the test script with a token from the **delegated user** (not the owner)
2. The delegated user should be able to:
   - Connect to the WebSocket
   - Send offers/answers/ice-candidates to the robot
   - Receive responses from the robot

3. A non-delegated user should receive `403 Forbidden` when trying to control the robot

## Troubleshooting

### "Unauthorized" Errors

- **Check token**: Ensure the JWT token is valid and not expired
- **Check token revocation**: If you signed out, the token may be revoked
- **Get fresh token**: Sign in again and get a new token

### "Robot not found" Errors

- **Register robot first**: The robot must register before clients can connect
- **Check robotId**: Ensure the `robotId` matches what was registered

### Messages Not Forwarding

- **Check connection IDs**: Verify both connections are active
- **Check CloudWatch logs**: Look for `[PACKET_FORWARD_ERROR]` entries
- **Verify authorization**: Ensure the sender has permission (owner, admin, or delegated operator)

### Delegation Not Working

- **Verify delegation exists**: Check `RobotOperatorTable` in DynamoDB
- **Check user ID**: Ensure `operatorUserId` matches the `sub` claim in the JWT token
- **Check robotId**: Ensure `robotId` matches exactly (case-sensitive)

## Advanced Testing

### Multiple Robots

Test with multiple robots by running the script multiple times with different `robotId` values.

### Concurrent Connections

The script can be modified to test many concurrent connections. See `scripts/test-websocket-local.ts` for the implementation.

### Load Testing

For load testing, consider using tools like:
- **k6**: https://k6.io/
- **Artillery**: https://www.artillery.io/
- **WebSocket King**: https://github.com/vi/websocket-king

## Next Steps

- Add more test scenarios to the script
- Create automated integration tests
- Set up CI/CD pipeline with WebSocket tests
- Monitor packet forwarding metrics in CloudWatch

