// amplify/backend.ts
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { setUserGroupLambda } from './functions/set-user-group/resource';
import { setRobotLambda } from './functions/set-robot/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

// === ADDED: bring in the TS signaling lambda resource
import { signaling } from './functions/signaling/resource';

// === ADDED: DynamoDB (connections & presence)
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';

// === ADDED: WebSocket API (alpha)
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha';
import {WebSocketLambdaIntegration as LambdaWebSocketIntegration} from '@aws-cdk/aws-apigatewayv2-integrations-alpha';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/
 */
const backend = defineBackend({
  auth,
  data,
  setUserGroupLambda,
  setRobotLambda,
  signaling, // === ADDED
});

const userPool = backend.auth.resources.userPool;
const tables = backend.data.resources.tables;
const setUserGroupLambdaFunction = backend.setUserGroupLambda.resources.lambda;
const setRobotLambdaFunction = backend.setRobotLambda.resources.lambda;

// === ADDED: DynamoDB tables for signaling
const connectionsTable = new Table(backend.stack, 'ConnectionsTable', {
  partitionKey: { name: 'connectionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  // pointInTimeRecovery: true, // optional safety net
});

const robotPresenceTable = new Table(backend.stack, 'RobotPresenceTable', {
  partitionKey: { name: 'robotId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  // pointInTimeRecovery: true,
});

// === ADDED: WebSocket API + stage (all routes -> signaling lambda)
const wsApi = new WebSocketApi(backend.stack, 'SignalingApi', {
  connectRouteOptions: {
    integration: new LambdaWebSocketIntegration(
      'ConnectIntegration',                    // <-- id
      backend.signaling.resources.lambda,      // <-- handler
    ),
  },
  disconnectRouteOptions: {
    integration: new LambdaWebSocketIntegration(
      'DisconnectIntegration',
      backend.signaling.resources.lambda,
    ),
  },
  defaultRouteOptions: {
    integration: new LambdaWebSocketIntegration(
      'DefaultIntegration',
      backend.signaling.resources.lambda,
    ),
  },
});

const wsStage = new WebSocketStage(backend.stack, 'ProdStage', {
  webSocketApi: wsApi,
  stageName: 'prod',
  autoDeploy: true,
});

// === ADDED: Env vars for signaling lambda
backend.signaling.addEnvironment('CONN_TABLE', connectionsTable.tableName);
backend.signaling.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
// API Gateway Management API must be HTTPS (convert wss:// -> https://)
backend.signaling.addEnvironment(
  'WS_MGMT_ENDPOINT',
  `https://${wsStage.url.replace('wss://', '').replace('ws://', '')}`,
);

// === ADDED: Permissions for signaling lambda
connectionsTable.grantReadWriteData(backend.signaling.resources.lambda);
robotPresenceTable.grantReadWriteData(backend.signaling.resources.lambda);

// Simplest allow-all manage-connections. You can later scope this to the stage ARN.
backend.signaling.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['execute-api:ManageConnections'],
    resources: ['*'],
  }),
);

// (Existing) Lambda env vars for other functions
backend.setUserGroupLambda.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.setRobotLambda.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.setRobotLambda.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);

// (Existing) permissions for other functions
userPool.grant(setUserGroupLambdaFunction, 'cognito-idp:AdminAddUserToGroup');
tables.Partner.grantReadData(setRobotLambdaFunction);
setRobotLambdaFunction.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:Scan'],
    resources: [`${tables.Partner.tableArn}/index/cognitoUsernameIndex`],
  }),
);
tables.Robot.grantWriteData(setRobotLambdaFunction);
