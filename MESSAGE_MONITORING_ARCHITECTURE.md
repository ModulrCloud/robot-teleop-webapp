# Message Monitoring Architecture

## Overview

The Message Logger component allows authorized users to monitor real-time WebSocket messages for debugging robot connections. This document explains how the monitoring system works and its security model.

## How Monitoring Works

### 1. **Subscription Flow**

```
┌─────────────┐                    ┌──────────────┐                    ┌─────────────┐
│   Logger    │                    │   Signaling   │                    │    Robot    │
│  (Browser)  │                    │    Server    │                    │   (Agent)   │
└──────┬──────┘                    └──────┬───────┘                    └──────┬──────┘
       │                                   │                                   │
       │ 1. Connect WebSocket              │                                   │
       │──────────────────────────────────>│                                   │
       │                                   │                                   │
       │ 2. Send monitor message           │                                   │
       │ { type: 'monitor', robotId: '...' }│                                   │
       │──────────────────────────────────>│                                   │
       │                                   │                                   │
       │                                   │ 3. Verify access (canAccessRobot) │
       │                                   │                                   │
       │                                   │ 4. Store subscription in           │
       │                                   │    ConnectionsTable with          │
       │                                   │    monitoringRobotId               │
       │                                   │                                   │
       │ 5. monitor-confirmed              │                                   │
       │<──────────────────────────────────│                                   │
       │                                   │                                   │
       │                                   │ 6. Robot registers                │
       │                                   │<──────────────────────────────────│
       │                                   │                                   │
       │                                   │ 7. Notify monitors                │
       │ 8. Receive monitor copy           │──────────────────────────────────>│
       │<──────────────────────────────────│                                   │
```

### 2. **Message Flow**

1. **Logger Connects**: The Message Logger component opens a WebSocket connection to the signaling server with the user's JWT token.

2. **Monitor Subscription**: When the WebSocket opens, the logger sends a `monitor` message:
   ```json
   {
     "type": "monitor",
     "robotId": "robot-2723ab06"
   }
   ```

3. **Access Verification**: The signaling server verifies the user has access to monitor this robot using `canAccessRobot()`:
   - Checks if user is the robot owner
   - Checks if user is an admin
   - Checks if user is a delegated operator
   - Checks if user's email/username is in the robot's ACL (allowedUsers)

4. **Subscription Storage**: If authorized, the server stores the subscription in `ConnectionsTable`:
   ```json
   {
     "connectionId": "abc123...",
     "userId": "user-uuid",
     "kind": "monitor",
     "monitoringRobotId": "robot-2723ab06",
     "ts": 1234567890
   }
   ```

5. **Confirmation**: Server sends back a `monitor-confirmed` message to the logger.

6. **Message Monitoring**: When messages come in for the monitored robot:
   - Robot sends `register` message → Server forwards copy to logger
   - Client sends `offer` to robot → Server forwards copy to logger
   - Robot sends `answer` to client → Server forwards copy to logger
   - Any WebRTC signaling messages → Server forwards copies to logger

### 3. **Message Format**

Monitor copies include special metadata:
```json
{
  "type": "register",
  "robotId": "robot-2723ab06",
  "from": "user-uuid",
  "_monitor": true,              // Flag indicating this is a monitor copy
  "_source": "connection-id-1",  // Source connection ID
  "_target": "connection-id-2",  // Target connection ID
  "_direction": "robot-to-server", // Message direction
  "timestamp": "2025-11-28T..."
}
```

## Security Model

### Access Control

The monitoring system uses the same access control as robot operations:

1. **Owner Access**: Robot owners can always monitor their robots
2. **Admin Access**: Users in the `ADMINS` group can monitor any robot
3. **Delegated Operator Access**: Users delegated as operators can monitor the robot
4. **ACL-Based Access**: If the robot has an ACL (`allowedUsers`), users in that list can monitor

### Security Checks

**In `handleMonitor()` (line 618):**
```typescript
const hasAccess = await canAccessRobot(robotId, claims);
if (!hasAccess) {
  return { statusCode: 403, body: 'Access denied: You are not authorized to monitor this robot' };
}
```

**In `canAccessRobot()` (lines 315-384):**
- First checks if user is owner/admin/delegate (always allowed)
- Then checks robot's ACL if it exists
- If ACL is empty/null, robot is open access (fail open for availability)

### Potential Security Concerns

1. **Fail-Open Behavior**: If ACL check fails (e.g., DynamoDB error), the system fails open (allows access). This prioritizes availability over security. Consider:
   - Adding audit logging for failed ACL checks
   - Implementing a fail-closed mode for production
   - Adding rate limiting to prevent abuse

2. **Connection Table Scanning**: `getMonitoringConnections()` uses a Scan operation, which:
   - Scans the entire ConnectionsTable (inefficient)
   - Could be slow with many connections
   - **Recommendation**: Add a GSI on `monitoringRobotId` for better performance

3. **Message Content**: Monitor copies include full message content, which may contain sensitive data:
   - SDP offers/answers contain network information
   - Consider redacting sensitive fields if needed

4. **Subscription Persistence**: Subscriptions are stored in ConnectionsTable but not explicitly cleaned up on disconnect:
   - `$disconnect` handler removes connection entries
   - But if WebSocket closes unexpectedly, stale subscriptions may remain
   - **Current behavior**: Stale subscriptions are harmless (they just won't receive messages)

## Troubleshooting

### Logger Not Receiving Messages

1. **Check Connection Status**: Logger should show "Connected to Server" (yellow dot)
2. **Check Monitor Subscription**: Look for "monitor-confirmed" message in logs
3. **Check Timing**: Logger must be subscribed BEFORE robot registers
4. **Check Access**: Verify user has access to the robot (owner/admin/ACL)
5. **Check CloudWatch Logs**: Look for `[MONITOR_SUBSCRIBED]` and `[MONITOR_NOTIFIED]` entries

### Debugging Steps

1. Open browser console and look for `[LOGGER] Received message:` logs
2. Check CloudWatch logs for the signaling Lambda:
   - `[MONITOR_SUBSCRIBED]` - Confirms subscription was created
   - `[MONITOR_NOTIFIED]` - Confirms messages were sent to monitors
   - `[MONITOR_DENIED]` - Access was denied
3. Verify the robot is actually sending messages (check robot logs)
4. Check if `getMonitoringConnections()` is finding the subscription

## Performance Considerations

1. **Scan Operation**: `getMonitoringConnections()` scans ConnectionsTable. For better performance:
   - Add GSI: `monitoringRobotId` as partition key
   - Use Query instead of Scan

2. **Message Volume**: Each message triggers a scan + send to all monitors. For high-volume scenarios:
   - Consider batching monitor notifications
   - Add rate limiting
   - Consider using SQS for async delivery

3. **Connection Cleanup**: Ensure `$disconnect` properly removes monitoring subscriptions

## Future Improvements

1. **GSI on monitoringRobotId**: Improve query performance
2. **Fail-closed mode**: Option to deny access if ACL check fails
3. **Message filtering**: Allow filtering which message types to monitor
4. **Historical logs**: Store messages in DynamoDB for later review
5. **Rate limiting**: Prevent abuse of monitoring feature
6. **Audit logging**: Log all monitor subscription attempts

