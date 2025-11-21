import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { setUserGroupLambda } from './functions/set-user-group/resource';
import { setRobotLambda } from './functions/set-robot/resource';
import { signaling } from './functions/signaling/resource';
import { revokeTokenLambda } from './functions/revoke-token/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  setUserGroupLambda,
  setRobotLambda,
  signaling,
  revokeTokenLambda,
});

const userPool = backend.auth.resources.userPool;
const tables = backend.data.resources.tables;
const setUserGroupLambdaFunction = backend.setUserGroupLambda.resources.lambda;
const setRobotLambdaFunction = backend.setRobotLambda.resources.lambda;
const signalingFunction = backend.signaling.resources.lambda;
const revokeTokenLambdaFunction = backend.revokeTokenLambda.resources.lambda;

// ============================================
// Signaling Function Resources
// ============================================

// Create a custom stack for signaling resources
const signalingStack = backend.createStack('SignalingResources');

// Create DynamoDB tables for signaling
const connTable = new Table(signalingStack, 'ConnectionsTable', {
  partitionKey: { name: 'connectionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
});

const robotPresenceTable = new Table(signalingStack, 'RobotPresenceTable', {
  partitionKey: { name: 'robotId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
});

// Revoked tokens table - stores tokens that have been revoked
// Uses TTL to automatically clean up expired tokens
const revokedTokensTable = new Table(signalingStack, 'RevokedTokensTable', {
  partitionKey: { name: 'tokenId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
  timeToLiveAttribute: 'ttl', // Automatically delete after TTL expires
});

// Create WebSocket API Gateway
const wsApi = new WebSocketApi(signalingStack, 'SignalingWebSocketApi', {
  connectRouteOptions: {
    integration: new WebSocketLambdaIntegration('ConnectIntegration', signalingFunction),
  },
  disconnectRouteOptions: {
    integration: new WebSocketLambdaIntegration('DisconnectIntegration', signalingFunction),
  },
  defaultRouteOptions: {
    integration: new WebSocketLambdaIntegration('DefaultIntegration', signalingFunction),
  },
});

const wsStage = new WebSocketStage(signalingStack, 'SignalingWebSocketStage', {
  webSocketApi: wsApi,
  stageName: 'prod',
  autoDeploy: true,
});

// Grant WebSocket API permission to invoke Lambda
wsApi.grantManageConnections(signalingFunction);

// Signaling Lambda environment variables
signalingFunction.addEnvironment('CONN_TABLE', connTable.tableName);
signalingFunction.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
signalingFunction.addEnvironment('REVOKED_TOKENS_TABLE', revokedTokensTable.tableName);
signalingFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
// Construct WebSocket management endpoint URL
// Format: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
const stack = Stack.of(signalingStack);
signalingFunction.addEnvironment('WS_MGMT_ENDPOINT', 
  `https://${wsApi.apiId}.execute-api.${stack.region}.amazonaws.com/${wsStage.stageName}`
);
signalingFunction.addEnvironment('AWS_REGION', stack.region);

// Grant DynamoDB permissions to signaling function
connTable.grantReadWriteData(signalingFunction);
robotPresenceTable.grantReadWriteData(signalingFunction);
revokedTokensTable.grantReadData(signalingFunction); // Read-only for checking blacklist

// Grant DynamoDB permissions to revoke token function
revokedTokensTable.grantWriteData(revokeTokenLambdaFunction);

// Revoke token Lambda environment variables
revokeTokenLambdaFunction.addEnvironment('REVOKED_TOKENS_TABLE', revokedTokensTable.tableName);

// Add WebSocket URL to outputs for frontend access
// Format: wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
const wsUrl = `wss://${wsApi.apiId}.execute-api.${stack.region}.amazonaws.com/${wsStage.stageName}`;
backend.addOutput({
  custom: {
    signaling: {
      websocketUrl: wsUrl,
    },
  },
});

// ============================================
// Existing Lambda Configuration
// ============================================

// Lambda environment variables
backend.setUserGroupLambda.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.setRobotLambda.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.setRobotLambda.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);

// Lambda permissions
userPool.grant(setUserGroupLambdaFunction, 'cognito-idp:AdminAddUserToGroup');
tables.Partner.grantReadData(setRobotLambdaFunction);
setRobotLambdaFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan"],
    resources: [
      `${tables.Partner.tableArn}/index/cognitoUsernameIndex`
    ]
}));
tables.Robot.grantWriteData(setRobotLambdaFunction);
