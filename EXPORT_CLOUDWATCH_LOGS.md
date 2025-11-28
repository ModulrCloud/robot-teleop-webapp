# How to Export CloudWatch Logs for Analysis

## Method 1: CloudWatch Logs Insights (Easiest)

1. **In CloudWatch Console:**
   - Click **"Logs Insights"** in the left sidebar
   - Select your log group: `/aws/lambda/amplify-robotteleop-undch--signalinglambda75CE8115-Lsv2iXh3b311`
   - Set time range to **"Last 1 hour"** (or custom range covering your test)

2. **Run this query (Updated - includes new AUTH logs):**
```sql
fields @timestamp, @message
| filter @message like /LAMBDA_INVOCATION/ or @message like /AUTH_FROM_CONNECTION_TABLE/ or @message like /AUTH_LOOKUP_ERROR/ or @message like /AUTH_FAILED/ or @message like /MONITOR/ or @message like /REGISTER/ or @message like /CONNECTION/ or @message like /NOTIFY/ or @message like /MESSAGE_RECEIVED/
| sort @timestamp desc
| limit 200
```

**Or use this more comprehensive query to see ALL Lambda activity:**
```sql
fields @timestamp, @message
| filter @message like /LAMBDA_INVOCATION/ or @message like /AUTH/ or @message like /MONITOR/ or @message like /REGISTER/ or @message like /CONNECTION/ or @message like /NOTIFY/ or @message like /MESSAGE_RECEIVED/ or @message like /ERROR/ or @message like /WARN/
| sort @timestamp desc
| limit 200
```

3. **Export the results:**
   - Click **"Export results"** button (top right)
   - Choose **"Download .csv"** or **"Download .txt"**
   - This will download all matching log entries

## Method 2: Copy from Log Stream (Quick)

1. **In the log stream view:**
   - Select all log entries (Ctrl+A or Cmd+A)
   - Copy (Ctrl+C or Cmd+C)
   - Paste into a text file
   - Save as `cloudwatch-logs.txt`

2. **Or use the filter:**
   - In the search box, type: `MONITOR|REGISTER|CONNECTION|NOTIFY`
   - This filters to relevant entries
   - Copy the filtered results

## Method 3: AWS CLI (If you have it configured)

Run this command in your terminal:

```bash
aws logs tail /aws/lambda/amplify-robotteleop-undch--signalinglambda75CE8115-Lsv2iXh3b311 --since 1h --format short > cloudwatch-logs.txt
```

This saves the last hour of logs to `cloudwatch-logs.txt`.

## Method 4: Export Specific Time Range

1. **In Log Stream view:**
   - Click **"Actions"** dropdown
   - Select **"Export data to S3"** (if you have S3 access)
   - Or use **"Download logs"** if available

## What to Include

Make sure the exported logs include:
- `[CONNECTION_ATTEMPT]` - When logger connects
- `[CONNECTION_SUCCESS]` - When connection is established
- `[MESSAGE_RECEIVED]` - When monitor message arrives
- `[MONITOR_MESSAGE_RECEIVED]` - When monitor message is processed
- `[MONITOR_STORE_ATTEMPT]` - When storing subscription
- `[MONITOR_SUBSCRIBED]` - When subscription is stored
- `[REGISTER_ATTEMPT]` - When robot registers
- `[REGISTER_SUCCESS]` - When registration succeeds
- `[NOTIFY_MONITORS_START]` - When trying to notify monitors
- `[MONITOR_QUERY_RESULT]` - Results of finding monitors
- `[NOTIFY_MONITORS_SKIP]` or `[MONITOR_NOTIFIED]` - Notification results

## Quick Test Sequence

1. Clear browser console
2. Open Message Logger
3. Wait for connection
4. Click "Test Connection" button
5. Connect your Python robot
6. Export logs from the last 5 minutes

This will give us a focused view of what's happening.

