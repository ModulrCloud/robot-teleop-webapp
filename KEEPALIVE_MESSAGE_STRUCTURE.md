# Keepalive Message Structure

## Ping Message (Server → Robot/Client)

The server sends periodic ping messages to keep WebSocket connections alive:

```json
{
  "type": "ping",
  "timestamp": 1234567890123,
  "keepalive": true
}
```

### Fields:
- **`type`**: Always `"ping"`
- **`timestamp`**: Unix timestamp in milliseconds (when ping was sent)
- **`keepalive`**: Always `true` (indicates this is a keepalive ping)

### Example:
```json
{
  "type": "ping",
  "timestamp": 1704067200000,
  "keepalive": true
}
```

## Pong Response (Robot/Client → Server)

Robots and clients should respond with a pong message:

```json
{
  "type": "pong",
  "timestamp": 1234567890123,
  "keepalive": true
}
```

### Fields:
- **`type`**: Always `"pong"`
- **`timestamp`**: Unix timestamp in milliseconds (when pong was sent, typically same as received ping)
- **`keepalive`**: Always `true` (indicates this is a keepalive pong)

### Example:
```json
{
  "type": "pong",
  "timestamp": 1704067200000,
  "keepalive": true
}
```

## Benefits of Pong Response

1. **Bidirectional Activity**: Both directions keep the connection alive
2. **Confirmation**: Server knows robot received the ping
3. **Monitoring**: Can track which robots are responding
4. **Standard Pattern**: Follows WebSocket ping/pong convention

## Implementation Notes

- Ping messages are sent every **5 minutes** by the server
- Robots should respond with pong **immediately** upon receiving ping
- No special routing needed - pong messages are logged but don't require special handling
- The connection stays alive from **either** direction (ping or pong)

