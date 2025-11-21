# Signaling Function Setup Summary

## What Was Missing

Your signaling function code was mostly complete, but several infrastructure pieces were missing from `backend.ts`:

### 1. **Function Import** ✅ FIXED
- The `signaling` function was not imported in `backend.ts`
- **Fixed**: Added `import { signaling } from './functions/signaling/resource';` and included it in `defineBackend()`

### 2. **Function Resource Definition** ✅ FIXED
- The `resource.ts` had incorrect properties (`name`, `entry`, `runtime`, `timeoutSeconds`, `memoryMB`)
- **Fixed**: Simplified to use Amplify Gen 2's auto-discovery pattern: `defineFunction({})`

### 3. **DynamoDB Tables** ✅ ADDED
- Missing tables: `CONN_TABLE` (ConnectionsTable) and `ROBOT_PRESENCE_TABLE` (RobotPresenceTable)
- **Added**: Created both tables in a custom CDK stack with:
  - `connectionId` as partition key for ConnectionsTable
  - `robotId` as partition key for RobotPresenceTable
  - PAY_PER_REQUEST billing mode
  - DESTROY removal policy (for dev/sandbox)

### 4. **WebSocket API Gateway** ✅ ADDED
- Missing WebSocket API Gateway setup
- **Added**: Created WebSocket API with:
  - `$connect` route → Lambda integration
  - `$disconnect` route → Lambda integration
  - `$default` route → Lambda integration (for all other messages)
  - Production stage with auto-deploy enabled

### 5. **Environment Variables** ✅ ADDED
- Missing environment variables for the Lambda function:
  - `CONN_TABLE` → ConnectionsTable name
  - `ROBOT_PRESENCE_TABLE` → RobotPresenceTable name
  - `WS_MGMT_ENDPOINT` → WebSocket management API endpoint URL
- **Added**: All three environment variables are now set

### 6. **IAM Permissions** ✅ ADDED
- Missing permissions for:
  - DynamoDB read/write access to both tables
  - API Gateway Management API access (to send messages via WebSocket)
- **Added**: 
  - `connTable.grantReadWriteData(signalingFunction)`
  - `robotPresenceTable.grantReadWriteData(signalingFunction)`
  - `wsApi.grantManageConnections(signalingFunction)`

### 7. **Missing Dependencies** ✅ ADDED
- Missing npm packages:
  - `@aws-sdk/client-apigatewaymanagementapi` (for WebSocket management API client)
  - `@aws-cdk/aws-apigatewayv2-alpha` (for WebSocket API Gateway)
  - `@aws-cdk/aws-apigatewayv2-integrations-alpha` (for Lambda integrations)
- **Added**: All packages added to `package.json`

## Next Steps

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Deploy the Backend**:
   ```bash
   npx ampx sandbox
   ```
   This will create:
   - The DynamoDB tables
   - The WebSocket API Gateway
   - The Lambda function with proper permissions
   - All environment variables

3. **Get the WebSocket URL**:
   After deployment, check `amplify_outputs.json` or the AWS Console to get the WebSocket API endpoint URL. It will be in the format:
   ```
   wss://{api-id}.execute-api.{region}.amazonaws.com/prod
   ```

4. **Update Frontend** (if needed):
   If your frontend code needs the WebSocket URL, you may need to:
   - Add it to `amplify_outputs.json` (via custom output)
   - Or read it from environment variables
   - Or construct it from the API ID and stage

## Files Modified

1. **`amplify/backend.ts`**:
   - Added signaling function import
   - Added DynamoDB tables
   - Added WebSocket API Gateway
   - Added environment variables
   - Added IAM permissions

2. **`amplify/functions/signaling/resource.ts`**:
   - Simplified to use Amplify Gen 2 auto-discovery

3. **`package.json`**:
   - Added `@aws-sdk/client-apigatewaymanagementapi`
   - Added `@aws-cdk/aws-apigatewayv2-alpha`
   - Added `@aws-cdk/aws-apigatewayv2-integrations-alpha`

## Handler Code Review

Your `handler.ts` looks good! It properly:
- ✅ Handles `$connect`, `$disconnect`, and message routing
- ✅ Uses JWT token decoding (though you noted this is temporary)
- ✅ Implements `register`, `takeover`, and WebRTC signaling (`offer`, `answer`, `ice-candidate`)
- ✅ Uses the correct AWS SDK clients
- ✅ Has proper error handling

## Notes

- The JWT decoding is currently done without verification (as noted in your comments). You may want to replace this with proper Cognito JWT verification later.
- The WebSocket management endpoint is constructed at deployment time, so it will be correct for your region.
- Both DynamoDB tables use `PAY_PER_REQUEST` billing, which is cost-effective for development but you may want to switch to provisioned capacity for production.

