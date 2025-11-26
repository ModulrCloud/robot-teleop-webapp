# Quick Guide: Access CloudWatch Logs from Amplify Console

## From Your Current Page (Amplify Console)

### Option 1: Via Backend Functions (Recommended)
1. In the Amplify Console, look for a **"Backend"** or **"Backend environments"** tab/section
2. Click on it to see your backend resources
3. Find the **"Functions"** section
4. Look for the **"signaling"** function
5. Click on it, then click **"View logs in CloudWatch"** or **"Logs"** tab

### Option 2: Direct CloudWatch Link
1. Click on **"App settings"** in the left sidebar
2. Look for backend environment details
3. Or go directly to CloudWatch: https://console.aws.amazon.com/cloudwatch

## Direct CloudWatch Access

1. **Go to CloudWatch Console:**
   - URL: https://console.aws.amazon.com/cloudwatch
   - Or search "CloudWatch" in AWS Console search bar

2. **Navigate to Logs:**
   - Click **"Log groups"** in the left sidebar

3. **Find Your Signaling Function Logs:**
   - Search for: `signaling` or `amplify-robotteleop`
   - Look for log group name like: `/aws/lambda/amplify-robotteleop-{identifier}-sandbox-{hash}-signaling`
   - The exact name depends on your sandbox identifier

4. **View Recent Logs:**
   - Click on the log group
   - Click the most recent **log stream** (sorted by "Last event time")
   - Look for entries prefixed with:
     - `[CONNECTION_ATTEMPT]`
     - `[CONNECTION_SUCCESS]`
     - `[CONNECTION_REJECTED]`
     - `[REGISTER_ATTEMPT]`
     - `[REGISTER_SUCCESS]`
     - `[REGISTER_ERROR]`

## Alternative: Via Lambda Console

1. Go to **AWS Lambda Console**: https://console.aws.amazon.com/lambda
2. Search for function with "signaling" in the name
3. Click on the function
4. Click **"Monitor"** tab
5. Click **"View CloudWatch logs"** button
6. This takes you directly to the log group

## What You're Looking For

When your robot tries to connect, you should see logs like:

```
[CONNECTION_ATTEMPT] {
  "connectionId": "...",
  "hasToken": true,
  ...
}
```

If you don't see ANY connection attempts, the robot isn't reaching AWS (network/firewall issue).

If you see connection attempts but they're rejected, check the `[CONNECTION_REJECTED]` entries for the reason.

