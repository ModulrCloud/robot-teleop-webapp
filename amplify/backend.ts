import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { setUserGroupLambda } from './functions/set-user-group/resource';
import { setRobotLambda } from './functions/set-robot/resource';
import { signaling } from './functions/signaling/resource';
import { revokeTokenLambda } from './functions/revoke-token/resource';
import { manageRobotOperator } from './functions/manage-robot-operator/resource';
import { deleteRobotLambda } from './functions/delete-robot/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Function as CdkFunction } from 'aws-cdk-lib/aws-lambda';

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
  manageRobotOperator,
  deleteRobotLambda,
});

const userPool = backend.auth.resources.userPool;
const tables = backend.data.resources.tables;
const setUserGroupLambdaFunction = backend.setUserGroupLambda.resources.lambda;
const setRobotLambdaFunction = backend.setRobotLambda.resources.lambda;
const signalingFunction = backend.signaling.resources.lambda;
const revokeTokenLambdaFunction = backend.revokeTokenLambda.resources.lambda;
const manageRobotOperatorFunction = backend.manageRobotOperator.resources.lambda;
const deleteRobotLambdaFunction = backend.deleteRobotLambda.resources.lambda;

// ============================================
// Signaling Function Resources
// ============================================

// Use the data stack to avoid circular dependencies
// The signaling function is in the data stack, so we put resources there too
const dataStack = Stack.of(backend.data.resources.graphqlApi);

// Create DynamoDB tables for signaling
const connTable = new Table(dataStack, 'ConnectionsTable', {
  partitionKey: { name: 'connectionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
});

const robotPresenceTable = new Table(dataStack, 'RobotPresenceTable', {
  partitionKey: { name: 'robotId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
});

// Revoked tokens table - stores tokens that have been revoked
// Uses TTL to automatically clean up expired tokens
const revokedTokensTable = new Table(dataStack, 'RevokedTokensTable', {
  partitionKey: { name: 'tokenId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
  timeToLiveAttribute: 'ttl', // Automatically delete after TTL expires
});

// Robot operator delegation table - tracks which users can operate which robots
const robotOperatorTable = new Table(dataStack, 'RobotOperatorTable', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
});
// Add GSI for robotId lookups
robotOperatorTable.addGlobalSecondaryIndex({
  indexName: 'robotIdIndex',
  partitionKey: { name: 'robotId', type: AttributeType.STRING },
});
// Add GSI for operatorUserId lookups
robotOperatorTable.addGlobalSecondaryIndex({
  indexName: 'operatorUserIdIndex',
  partitionKey: { name: 'operatorUserId', type: AttributeType.STRING },
});

// Create WebSocket API Gateway
const wsApi = new WebSocketApi(dataStack, 'SignalingWebSocketApi', {
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

const wsStage = new WebSocketStage(dataStack, 'SignalingWebSocketStage', {
  webSocketApi: wsApi,
  stageName: 'prod',
  autoDeploy: true,
});

// Grant WebSocket API permission to invoke Lambda
wsApi.grantManageConnections(signalingFunction);

// Signaling Lambda environment variables
// Cast to CDK Function to access addEnvironment method
const signalingCdkFunction = signalingFunction as CdkFunction;
signalingCdkFunction.addEnvironment('CONN_TABLE', connTable.tableName);
signalingCdkFunction.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
signalingCdkFunction.addEnvironment('REVOKED_TOKENS_TABLE', revokedTokensTable.tableName);
signalingCdkFunction.addEnvironment('ROBOT_OPERATOR_TABLE', robotOperatorTable.tableName);
signalingCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
// Construct WebSocket management endpoint URL
// Format: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
signalingCdkFunction.addEnvironment('WS_MGMT_ENDPOINT', 
  `https://${wsApi.apiId}.execute-api.${dataStack.region}.amazonaws.com/${wsStage.stageName}`
);
// Note: AWS_REGION is automatically provided by Lambda runtime, don't set it manually

// Grant DynamoDB permissions to signaling function
connTable.grantReadWriteData(signalingFunction);
robotPresenceTable.grantReadWriteData(signalingFunction);
revokedTokensTable.grantReadData(signalingFunction); // Read-only for checking blacklist
robotOperatorTable.grantReadData(signalingFunction); // Read-only for checking delegations

// Grant DynamoDB permissions to revoke token function
revokedTokensTable.grantWriteData(revokeTokenLambdaFunction);

// Revoke token Lambda environment variables
const revokeTokenCdkFunction = revokeTokenLambdaFunction as CdkFunction;
revokeTokenCdkFunction.addEnvironment('REVOKED_TOKENS_TABLE', revokedTokensTable.tableName);

// Add WebSocket URL to outputs for frontend access
// Format: wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
const wsUrl = `wss://${wsApi.apiId}.execute-api.${dataStack.region}.amazonaws.com/${wsStage.stageName}`;
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

// Delete robot Lambda environment variables
backend.deleteRobotLambda.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.deleteRobotLambda.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);

// Manage robot operator Lambda environment variables
const manageRobotOperatorCdkFunction = manageRobotOperatorFunction as CdkFunction;
manageRobotOperatorCdkFunction.addEnvironment('ROBOT_OPERATOR_TABLE', robotOperatorTable.tableName);
manageRobotOperatorCdkFunction.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
manageRobotOperatorCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
manageRobotOperatorCdkFunction.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);
manageRobotOperatorCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);

// Grant DynamoDB permissions to manage robot operator function
robotOperatorTable.grantReadWriteData(manageRobotOperatorFunction);
robotPresenceTable.grantReadData(manageRobotOperatorFunction);
tables.Robot.grantReadData(manageRobotOperatorFunction);
tables.Partner.grantReadData(manageRobotOperatorFunction);

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

// Grant DynamoDB permissions to delete robot function
tables.Robot.grantReadWriteData(deleteRobotLambdaFunction);
tables.Partner.grantReadData(deleteRobotLambdaFunction);
// Grant permission to query the cognitoUsernameIndex (needed for ownership verification)
deleteRobotLambdaFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan"],
  resources: [
    `${tables.Partner.tableArn}/index/cognitoUsernameIndex`
  ]
}));
