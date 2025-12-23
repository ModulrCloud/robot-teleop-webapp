import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { setUserGroupLambda } from './functions/set-user-group/resource';
import { setRobotLambda } from './functions/set-robot/resource';
import { updateRobotLambda } from './functions/update-robot/resource';
import { signaling } from './functions/signaling/resource';
import { revokeTokenLambda } from './functions/revoke-token/resource';
import { manageRobotOperator } from './functions/manage-robot-operator/resource';
import { deleteRobotLambda } from './functions/delete-robot/resource';
import { manageRobotACL } from './functions/manage-robot-acl/resource';
import { listAccessibleRobots } from './functions/list-accessible-robots/resource';
import { getRobotStatus } from './functions/get-robot-status/resource';
import { getSessionLambda } from './functions/get-session/resource';
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
  storage,
  setUserGroupLambda,
  setRobotLambda,
  updateRobotLambda,
  signaling,
  revokeTokenLambda,
  manageRobotOperator,
  deleteRobotLambda,
  manageRobotACL,
  listAccessibleRobots,
  getRobotStatus,
  getSessionLambda,
});

const userPool = backend.auth.resources.userPool;
const userPoolClient = backend.auth.resources.userPoolClient;
const tables = backend.data.resources.tables;

// Configure token expiration times for Cognito User Pool Client
// Range: 5 minutes to 1 day (1440 minutes) for Access/Id tokens
// Range: 1-3650 days for Refresh token
// Set to 4 hours (240 minutes) for Access/Id tokens - good balance for robots and security
// Set to 30 days for Refresh token
// 
// IMPORTANT: These settings apply to ALL users in the User Pool
// If you need different expiration for robots vs users, you'll need separate User Pool Clients
//
// NOTE: Token expiration overrides are temporarily disabled due to CloudFormation update issues.
// These properties may need to be configured via AWS Console or during initial User Pool Client creation.
// To configure manually:
// 1. Go to AWS Cognito Console
// 2. Select your User Pool
// 3. Go to App integration > App clients
// 4. Edit the app client
// 5. Set Access token expiration: 240 minutes (4 hours)
// 6. Set ID token expiration: 240 minutes (4 hours)
// 7. Set Refresh token expiration: 30 days
//
// TODO: Find correct CDK method to set these properties or configure during auth resource definition
// const cfnUserPoolClient = userPoolClient.node.defaultChild;
// if (cfnUserPoolClient) {
//   (cfnUserPoolClient as any).addOverride('Properties.AccessTokenValidity', 240);
//   (cfnUserPoolClient as any).addOverride('Properties.IdTokenValidity', 240);
//   (cfnUserPoolClient as any).addOverride('Properties.RefreshTokenValidity', 30);
// }
const setUserGroupLambdaFunction = backend.setUserGroupLambda.resources.lambda;
const setRobotLambdaFunction = backend.setRobotLambda.resources.lambda;
const updateRobotLambdaFunction = backend.updateRobotLambda.resources.lambda;
const signalingFunction = backend.signaling.resources.lambda;
const revokeTokenLambdaFunction = backend.revokeTokenLambda.resources.lambda;
const manageRobotOperatorFunction = backend.manageRobotOperator.resources.lambda;
const deleteRobotLambdaFunction = backend.deleteRobotLambda.resources.lambda;
const manageRobotACLFunction = backend.manageRobotACL.resources.lambda;
const listAccessibleRobotsFunction = backend.listAccessibleRobots.resources.lambda;
const getRobotStatusFunction = backend.getRobotStatus.resources.lambda;
const getSessionLambdaFunction = backend.getSessionLambda.resources.lambda;

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
signalingCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
signalingCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
// DEVELOPMENT ONLY: Set ALLOW_NO_TOKEN=true to allow connections without JWT tokens (for testing)
// ⚠️ WARNING: Never set this in production! This bypasses all authentication.
// signalingCdkFunction.addEnvironment('ALLOW_NO_TOKEN', 'true'); // Uncomment for local testing
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
tables.Robot.grantReadData(signalingFunction); // Read-only for checking ACLs
tables.Session.grantReadWriteData(signalingFunction); // Read/write for session management
signalingCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);

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
backend.updateRobotLambda.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.updateRobotLambda.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);

// Delete robot Lambda environment variables
backend.deleteRobotLambda.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.deleteRobotLambda.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);

// Manage robot ACL Lambda environment variables
backend.manageRobotACL.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.manageRobotACL.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);

// List accessible robots Lambda environment variables
backend.listAccessibleRobots.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.listAccessibleRobots.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);
backend.listAccessibleRobots.addEnvironment('ROBOT_OPERATOR_TABLE_NAME', robotOperatorTable.tableName);

// Get robot status Lambda environment variables
const getRobotStatusCdkFunction = getRobotStatusFunction as CdkFunction;
getRobotStatusCdkFunction.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);

// Grant DynamoDB permissions to get robot status function
robotPresenceTable.grantReadData(getRobotStatusFunction);

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
tables.Partner.grantReadData(updateRobotLambdaFunction);
updateRobotLambdaFunction.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [
    tables.Partner.tableArn + '/index/cognitoUsernameIndex',
  ],
}));
tables.Robot.grantReadWriteData(updateRobotLambdaFunction);

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

// Grant DynamoDB permissions to manage robot ACL function
tables.Robot.grantReadWriteData(manageRobotACLFunction);
tables.Partner.grantReadData(manageRobotACLFunction);
// Grant permission to query the cognitoUsernameIndex (needed for ownership verification)
manageRobotACLFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan"],
  resources: [
    `${tables.Partner.tableArn}/index/cognitoUsernameIndex`
  ]
}));

// Grant DynamoDB permissions to list accessible robots function
tables.Robot.grantReadData(listAccessibleRobotsFunction);
tables.Partner.grantReadData(listAccessibleRobotsFunction);
robotOperatorTable.grantReadData(listAccessibleRobotsFunction);
// Grant permission to query the cognitoUsernameIndex (needed for ownership verification)
listAccessibleRobotsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan"],
  resources: [
    `${tables.Partner.tableArn}/index/cognitoUsernameIndex`,
    `${robotOperatorTable.tableArn}/index/robotIdIndex`
  ]
}));

// Get session Lambda configuration
const getSessionCdkFunction = getSessionLambdaFunction as CdkFunction;
getSessionCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);
tables.Session.grantReadData(getSessionLambdaFunction);
getSessionLambdaFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.Session.tableArn}/index/userIdIndex`
  ]
}));
