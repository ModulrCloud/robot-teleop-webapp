# How to View CloudWatch Logs for Robot Connections

## Quick Access via AWS Console

### Method 1: Via Amplify Console (Easiest)

1. Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify)
2. Select your app
3. Click on **"Backend environments"** or **"Backend"** tab
4. Find your sandbox environment
5. Look for **"Functions"** section
6. Click on the **"signaling"** function
7. Click **"View logs in CloudWatch"** or **"Logs"** tab

### Method 2: Direct CloudWatch Access

1. Go to [AWS CloudWatch Console](https://console.aws.amazon.com/cloudwatch)
2. Click **"Log groups"** in the left sidebar
3. Search for: `/aws/lambda/amplify-robotteleop-{identifier}-sandbox-{hash}-signaling`
   - The exact name depends on your sandbox identifier
   - Look for log groups containing "signaling" in the name
4. Click on the log group
5. Click on the most recent **log stream** (sorted by "Last event time")

### Method 3: Find Log Group Name from Amplify Outputs

The log group name follows this pattern:
```
/aws/lambda/amplify-robotteleop-{your-identifier}-sandbox-{hash}-signaling
```

You can find it in:
- AWS Console → Lambda → Functions → Look for function with "signaling" in name
- The function name will show the full log group path

## What to Look For in Logs

### Connection Attempts

Look for these log entries:

```
[CONNECTION_ATTEMPT] {
  "connectionId": "abc123...",
  "requestTime": "2024-01-15T10:30:00.000Z",
  "hasToken": true,
  "sourceIp": "1.2.3.4",
  "userAgent": "..."
}
```

### Successful Connections

```
[CONNECTION_SUCCESS] {
  "connectionId": "abc123...",
  "userId": "google_102422572418235886155",
  "username": "user@example.com",
  "groups": ["PARTNERS"]
}
```

### Failed Connections

```
[CONNECTION_REJECTED] {
  "connectionId": "abc123...",
  "reason": "Invalid or missing token",
  "hasToken": false
}
```

### Registration Attempts

```
[REGISTER_ATTEMPT] {
  "connectionId": "abc123...",
  "robotId": "robot-12345678",
  "userId": "google_102422572418235886155"
}
```

### Registration Success

```
[REGISTER_SUCCESS] {
  "connectionId": "abc123...",
  "robotId": "robot-12345678",
  "userId": "google_102422572418235886155"
}
```

### Registration Errors

```
[REGISTER_ERROR] {
  "connectionId": "abc123...",
  "robotId": "robot-12345678",
  "reason": "robotId required"  // or other error messages
}
```

## Common Error Messages

### Token Issues
- `"reason": "Invalid or missing token"` - Token not provided or invalid
- `"Token expired"` - Token has expired (check expiration time)
- `"JWT verification failed"` - Token signature invalid or malformed

### Registration Issues
- `"reason": "robotId required"` - Registration message missing robotId
- `"Robot is already registered by another owner"` - Robot claimed by different user
- `"DynamoDB error"` - Database operation failed

## Filtering Logs

### In CloudWatch Logs Insights

1. Click **"Logs Insights"** in CloudWatch
2. Select your signaling function log group
3. Use queries like:

```sql
-- Find all connection attempts
fields @timestamp, @message
| filter @message like /CONNECTION_ATTEMPT/
| sort @timestamp desc

-- Find all registration attempts
fields @timestamp, @message
| filter @message like /REGISTER/
| sort @timestamp desc

-- Find errors
fields @timestamp, @message
| filter @message like /ERROR/ or @message like /REJECTED/
| sort @timestamp desc

-- Find specific robot ID
fields @timestamp, @message
| filter @message like /robot-12345678/
| sort @timestamp desc
```

## Real-Time Monitoring

### Stream Logs to Terminal

If you have AWS CLI configured:

```bash
# Install AWS CLI if needed
# Then stream logs:
aws logs tail /aws/lambda/amplify-robotteleop-undch-sandbox-{hash}-signaling --follow
```

Replace `{hash}` with your actual sandbox hash (check Lambda function name in AWS Console).

## Troubleshooting Steps

1. **Check if connection attempt was received:**
   - Look for `[CONNECTION_ATTEMPT]` entries
   - If missing, robot isn't reaching AWS (network/firewall issue)

2. **Check token validation:**
   - Look for `[CONNECTION_REJECTED]` with `"reason": "Invalid or missing token"`
   - If present, token is expired or invalid

3. **Check registration:**
   - Look for `[REGISTER_ATTEMPT]` entries
   - If missing, robot isn't sending registration message
   - If present but fails, check `[REGISTER_ERROR]` for reason

4. **Check for successful registration:**
   - Look for `[REGISTER_SUCCESS]` entries
   - If present, robot is connected and registered!

## Adding More Logging

If you need more detailed logs, the handler already logs:
- Connection attempts with connection ID and token status
- Token verification results
- Registration attempts and results
- Message routing
- Errors with context

All logs are prefixed with tags like `[CONNECTION_ATTEMPT]`, `[REGISTER_SUCCESS]`, etc. for easy filtering.

