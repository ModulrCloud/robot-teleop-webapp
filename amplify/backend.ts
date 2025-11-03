import { defineBackend, defineFunction } from '@aws-amplify/backend'; // === ADDED: defineFunction
import { auth } from './auth/resource';
import { data } from './data/resource';
import { setUserGroupLambda } from './functions/set-user-group/resource';
import { setRobotLambda } from './functions/set-robot/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

// === ADDED: DynamoDB (tables for connections & presence)
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';

// === ADDED: WebSocket API (alpha)
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha';
import { LambdaWebSocketIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */

// === ADDED: Python signaling Lambda definition
export const signalingFn = defineFunction({
  name: 'signaling',
  entry: './functions/signaling/handler.py',
  runtime: 'python3.12',
  timeoutSeconds: 30,
});

const backend = defineBackend({
  auth,
  data,
  setUserGroupLambda,
  setRobotLambda,
  signalingFn, // === ADDED
});

const userPool = backend.auth.resources.userPool;
const tables = backend.data.resources.tables;
const setUserGroupLambdaFunction = backend.setUserGroupLambda.resources.lambda;
const setRobotLambdaFunction = backend.setRobotLambda.resources.lambda;

// === ADDED: Create DynamoDB tables for signaling
const connectionsTable = new Table(backend.stack, 'ConnectionsTable', {
  partitionKey: { name: 'connectionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  // Point-in-time recovery is a nice safety net (optional):
  // pointInTimeRecovery: true,
});

const robotPresenceTable = new Table(backend.stack, 'RobotPresenceTable', {
  partitionKey: { name: 'robotId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  // pointInTimeRecovery: true,
});

// === ADDED: Create WebSocket API + stage, integrate all routes to signaling Lambda
const wsApi = new WebSocketApi(backend.stack, 'SignalingApi', {
  connectRouteOptions: {
    integration: new LambdaWebSocketIntegration({
      handler: backend.signalingFn.resources.lambda,
    }),
  },
  disconnectRouteOptions: {
    integration: new LambdaWebSocketIntegration({
      handler: backend.signalingFn.resources.lambda,
    }),
  },
  defaultRouteOptions: {
    integration: new LambdaWebSocketIntegration({
      handler: backend.signalingFn.resources.lambda,
    }),
  },
});

const wsStage = new WebSocketStage(backend.stack, 'ProdStage', {
  webSocketApi: wsApi,
  stageName: 'prod',
  autoDeploy: true,
});

// === ADDED: Environment variables for the Python Lambda
backend.signalingFn.addEnvironment('CONN_TABLE', connectionsTable.tableName);
backend.signalingFn.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
// API Gateway Management API needs HTTPS endpoint, not wss://
backend.signalingFn.addEnvironment(
   'WS_MGMT_ENDPOINT',
   `https://${wsStage.url.replace('wss://', '').replace('ws://', '')}`
 );

// === ADDED: Permissions — DynamoDB RW + ManageConnections
connectionsTable.grantReadWriteData(backend.signalingFn.resources.lambda);
robotPresenceTable.grantReadWriteData(backend.signalingFn.resources.lambda);

// Tighten this ARN if you like; '*' is simplest to start.
// For strict least-privilege, compute the execute-api ARN for your API/stage.
backend.signalingFn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['execute-api:ManageConnections'],
    resources: ['*'],
  })
);

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
