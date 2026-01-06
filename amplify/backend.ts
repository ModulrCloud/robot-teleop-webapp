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
import { createStripeCheckout } from './functions/create-stripe-checkout/resource';
import { addCredits } from './functions/add-credits/resource';
import { verifyStripePayment } from './functions/verify-stripe-payment/resource';
import { getUserCredits } from './functions/get-user-credits/resource';
import { updateAutoTopUp } from './functions/update-auto-topup/resource';
import { assignAdmin } from './functions/assign-admin/resource';
import { removeAdmin } from './functions/remove-admin/resource';
import { listAdmins } from './functions/list-admins/resource';
import { listUsers } from './functions/list-users/resource';
import { getSystemStats } from './functions/get-system-stats/resource';
import { listAuditLogs } from './functions/list-audit-logs/resource';
import { processSessionPayment } from './functions/process-session-payment/resource';
import { deductSessionCredits } from './functions/deduct-session-credits/resource';
import { createOrUpdateRating } from './functions/create-or-update-rating/resource';
import { listRobotRatings } from './functions/list-robot-ratings/resource';
import { createRatingResponse } from './functions/create-rating-response/resource';
import { createRobotReservation } from './functions/create-robot-reservation/resource';
import { listRobotReservations } from './functions/list-robot-reservations/resource';
import { cancelRobotReservation } from './functions/cancel-robot-reservation/resource';
import { checkRobotAvailability } from './functions/check-robot-availability/resource';
import { manageRobotAvailability } from './functions/manage-robot-availability/resource';
import { processRobotReservationRefunds } from './functions/process-robot-reservation-refunds/resource';
import { listPartnerPayouts } from './functions/list-partner-payouts/resource';
import { processPayout } from './functions/process-payout/resource';
import { getSessionLambda } from './functions/get-session/resource';
import { cleanupStaleConnections } from './functions/cleanup-stale-connections/resource';
import { triggerConnectionCleanup } from './functions/trigger-connection-cleanup/resource';
import { getActiveRobots } from './functions/get-active-robots/resource';
import { manageCreditTier } from './functions/manage-credit-tier/resource';
import { cleanupAuditLogs } from './functions/cleanup-audit-logs/resource';
import { websocketKeepalive } from './functions/websocket-keepalive/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { RemovalPolicy, Stack, Duration } from 'aws-cdk-lib';
import { Function as CdkFunction } from 'aws-cdk-lib/aws-lambda';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';

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
  createStripeCheckout,
  addCredits,
  verifyStripePayment,
  getUserCredits,
  updateAutoTopUp,
  assignAdmin,
  removeAdmin,
  listAdmins,
  listUsers,
  getSystemStats,
  listAuditLogs,
  processSessionPayment,
  deductSessionCredits,
  createOrUpdateRating,
  listRobotRatings,
  createRatingResponse,
  createRobotReservation,
  listRobotReservations,
  cancelRobotReservation,
  checkRobotAvailability,
  manageRobotAvailability,
  processRobotReservationRefunds,
  listPartnerPayouts,
  processPayout,
  getSessionLambda,
  cleanupStaleConnections,
  triggerConnectionCleanup,
  getActiveRobots,
  manageCreditTier,
  cleanupAuditLogs,
  websocketKeepalive,
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
const createStripeCheckoutFunction = backend.createStripeCheckout.resources.lambda;
const addCreditsFunction = backend.addCredits.resources.lambda;
const verifyStripePaymentFunction = backend.verifyStripePayment.resources.lambda;
const getUserCreditsFunction = backend.getUserCredits.resources.lambda;
const updateAutoTopUpFunction = backend.updateAutoTopUp.resources.lambda;
const assignAdminFunction = backend.assignAdmin.resources.lambda;
const removeAdminFunction = backend.removeAdmin.resources.lambda;
const listAdminsFunction = backend.listAdmins.resources.lambda;
const listUsersFunction = backend.listUsers.resources.lambda;
const getSystemStatsFunction = backend.getSystemStats.resources.lambda;
const listAuditLogsFunction = backend.listAuditLogs.resources.lambda;
const processSessionPaymentFunction = backend.processSessionPayment.resources.lambda;
const deductSessionCreditsFunction = backend.deductSessionCredits.resources.lambda;
const createOrUpdateRatingFunction = backend.createOrUpdateRating.resources.lambda;
const listRobotRatingsFunction = backend.listRobotRatings.resources.lambda;
const createRatingResponseFunction = backend.createRatingResponse.resources.lambda;
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
// Add GSI for monitoringRobotId lookups (for finding all connections monitoring a robot)
connTable.addGlobalSecondaryIndex({
  indexName: 'monitoringRobotIdIndex',
  partitionKey: { name: 'monitoringRobotId', type: AttributeType.STRING },
});
// Add GSI for timestamp lookups (for cleanup job to find stale connections efficiently)
connTable.addGlobalSecondaryIndex({
  indexName: 'timestampIndex',
  partitionKey: { name: 'ts', type: AttributeType.NUMBER },
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
tables.UserCredits.grantReadData(signalingFunction); // Read-only for balance checks
tables.PlatformSettings.grantReadData(signalingFunction); // Read-only for platform markup
// Grant permission to query GSIs
signalingFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${connTable.tableArn}/index/monitoringRobotIdIndex`,
    `${tables.Session.tableArn}/index/connectionIdIndex`,
  ],
}));
signalingCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);
signalingCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
signalingCdkFunction.addEnvironment('PLATFORM_SETTINGS_TABLE', tables.PlatformSettings.tableName);

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
backend.deleteRobotLambda.addEnvironment('USER_POOL_ID', userPool.userPoolId);

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
userPool.grant(setUserGroupLambdaFunction, 'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminRemoveUserFromGroup', 'cognito-idp:AdminListGroupsForUser', 'cognito-idp:AdminGetUser');
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

// Stripe checkout Lambda - FRONTEND_URL is set via secret in resource.ts
const createStripeCheckoutCdkFunction = createStripeCheckoutFunction as CdkFunction;
createStripeCheckoutCdkFunction.addEnvironment('CREDIT_TIER_TABLE', tables.CreditTier.tableName);
tables.CreditTier.grantReadData(createStripeCheckoutFunction);
// Grant permission to query the tierIdIndex GSI
createStripeCheckoutFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.CreditTier.tableArn}/index/tierIdIndex`,
  ],
}));

// Add credits Lambda environment variables and permissions
const addCreditsCdkFunction = addCreditsFunction as CdkFunction;
addCreditsCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
addCreditsCdkFunction.addEnvironment('CREDIT_TRANSACTIONS_TABLE', tables.CreditTransaction.tableName);
addCreditsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
// Note: ADMIN_AUDIT_TABLE will be set after adminAuditTable is created below
tables.UserCredits.grantReadWriteData(addCreditsFunction);
tables.CreditTransaction.grantWriteData(addCreditsFunction);
userPool.grant(addCreditsFunction, 'cognito-idp:AdminGetUser');
// Note: adminAuditTable.grantWriteData will be set after adminAuditTable is created below
// Grant permission to query the userIdIndex (needed for looking up by userId)
addCreditsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.UserCredits.tableArn}/index/userIdIndex`
  ]
}));

// Verify Stripe payment Lambda - no additional permissions needed (just uses Stripe API)

// Get user credits Lambda environment variables and permissions
const getUserCreditsCdkFunction = getUserCreditsFunction as CdkFunction;
getUserCreditsCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
tables.UserCredits.grantReadData(getUserCreditsFunction);
// Grant permission to query the userIdIndex (needed for looking up by userId)
getUserCreditsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.UserCredits.tableArn}/index/userIdIndex`
  ]
}));

// Update auto top-up Lambda environment variables and permissions
const updateAutoTopUpCdkFunction = updateAutoTopUpFunction as CdkFunction;
updateAutoTopUpCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
tables.UserCredits.grantReadWriteData(updateAutoTopUpFunction);
// Grant permission to query the userIdIndex (needed for looking up by userId)
updateAutoTopUpFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.UserCredits.tableArn}/index/userIdIndex`
  ]
}));

// Process session payment Lambda environment variables and permissions
const processSessionPaymentCdkFunction = processSessionPaymentFunction as CdkFunction;
processSessionPaymentCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
processSessionPaymentCdkFunction.addEnvironment('CREDIT_TRANSACTIONS_TABLE', tables.CreditTransaction.tableName);
processSessionPaymentCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);
processSessionPaymentCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
processSessionPaymentCdkFunction.addEnvironment('PLATFORM_SETTINGS_TABLE', tables.PlatformSettings.tableName);
processSessionPaymentCdkFunction.addEnvironment('PARTNER_PAYOUT_TABLE', tables.PartnerPayout.tableName);
tables.UserCredits.grantReadWriteData(processSessionPaymentFunction);
tables.CreditTransaction.grantWriteData(processSessionPaymentFunction);
tables.Session.grantReadWriteData(processSessionPaymentFunction);
tables.Robot.grantReadData(processSessionPaymentFunction);
tables.PlatformSettings.grantReadData(processSessionPaymentFunction);
tables.PartnerPayout.grantWriteData(processSessionPaymentFunction);
// Grant permission to query the userIdIndex (needed for looking up by userId)
processSessionPaymentFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.UserCredits.tableArn}/index/userIdIndex`,
    `${tables.Robot.tableArn}/index/robotIdIndex`
  ]
}));

// Deduct session credits Lambda environment variables and permissions
const deductSessionCreditsCdkFunction = deductSessionCreditsFunction as CdkFunction;
deductSessionCreditsCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
deductSessionCreditsCdkFunction.addEnvironment('CREDIT_TRANSACTIONS_TABLE', tables.CreditTransaction.tableName);
deductSessionCreditsCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);
deductSessionCreditsCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
deductSessionCreditsCdkFunction.addEnvironment('PLATFORM_SETTINGS_TABLE', tables.PlatformSettings.tableName);
tables.UserCredits.grantReadWriteData(deductSessionCreditsFunction);
tables.CreditTransaction.grantWriteData(deductSessionCreditsFunction);
tables.Session.grantReadWriteData(deductSessionCreditsFunction);
tables.Robot.grantReadData(deductSessionCreditsFunction);
tables.PlatformSettings.grantReadData(deductSessionCreditsFunction);
// Grant permission to query indexes
deductSessionCreditsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.UserCredits.tableArn}/index/userIdIndex`,
    `${tables.Robot.tableArn}/index/robotIdIndex`,
    `${tables.PlatformSettings.tableArn}/index/settingKeyIndex`,
  ],
}));

// Create or update rating Lambda environment variables and permissions
const createOrUpdateRatingCdkFunction = createOrUpdateRatingFunction as CdkFunction;
createOrUpdateRatingCdkFunction.addEnvironment('ROBOT_RATING_TABLE', tables.RobotRating.tableName);
createOrUpdateRatingCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
createOrUpdateRatingCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);
createOrUpdateRatingCdkFunction.addEnvironment('CLIENT_TABLE_NAME', tables.Client.tableName);
createOrUpdateRatingCdkFunction.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);
createOrUpdateRatingCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotRating.grantReadWriteData(createOrUpdateRatingFunction);
tables.Robot.grantReadWriteData(createOrUpdateRatingFunction); // Read for lookup, Write for updating averageRating
tables.Session.grantReadData(createOrUpdateRatingFunction);
tables.Client.grantReadData(createOrUpdateRatingFunction);
tables.Partner.grantReadData(createOrUpdateRatingFunction);
// Grant permission to query indexes
createOrUpdateRatingFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.Robot.tableArn}/index/robotIdIndex`,
    `${tables.RobotRating.tableArn}/index/robotIdIndex`,
    `${tables.Client.tableArn}/index/cognitoUsernameIndex`,
    `${tables.Partner.tableArn}/index/cognitoUsernameIndex`,
  ],
}));
// Grant Cognito permission to get user email
userPool.grant(createOrUpdateRatingFunction, 'cognito-idp:AdminGetUser');

// List robot ratings Lambda environment variables and permissions
const listRobotRatingsCdkFunction = listRobotRatingsFunction as CdkFunction;
listRobotRatingsCdkFunction.addEnvironment('ROBOT_RATING_TABLE', tables.RobotRating.tableName);
listRobotRatingsCdkFunction.addEnvironment('ROBOT_RATING_RESPONSE_TABLE', tables.RobotRatingResponse.tableName);
listRobotRatingsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotRating.grantReadData(listRobotRatingsFunction);
tables.RobotRatingResponse.grantReadData(listRobotRatingsFunction);
// Grant permission to query indexes
listRobotRatingsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.RobotRating.tableArn}/index/robotIdIndex`,
    `${tables.RobotRatingResponse.tableArn}/index/ratingIdIndex`,
  ],
}));
// Grant Cognito permission to get user email (for admin check)
userPool.grant(listRobotRatingsFunction, 'cognito-idp:AdminGetUser');

// Create rating response Lambda environment variables and permissions
const createRatingResponseCdkFunction = createRatingResponseFunction as CdkFunction;
createRatingResponseCdkFunction.addEnvironment('ROBOT_RATING_TABLE', tables.RobotRating.tableName);
createRatingResponseCdkFunction.addEnvironment('ROBOT_RATING_RESPONSE_TABLE', tables.RobotRatingResponse.tableName);
createRatingResponseCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
createRatingResponseCdkFunction.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);
createRatingResponseCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotRating.grantReadData(createRatingResponseFunction);
tables.RobotRatingResponse.grantReadWriteData(createRatingResponseFunction);
tables.Robot.grantReadData(createRatingResponseFunction);
tables.Partner.grantReadData(createRatingResponseFunction);
// Grant permission to query indexes
createRatingResponseFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.Robot.tableArn}/index/robotIdIndex`,
    `${tables.RobotRatingResponse.tableArn}/index/ratingIdIndex`,
    `${tables.Partner.tableArn}/index/cognitoUsernameIndex`,
  ],
}));
// Grant Cognito permission to get partner email
userPool.grant(createRatingResponseFunction, 'cognito-idp:AdminGetUser');

// ============================================
// Robot Reservation Lambda Functions
// ============================================

const createRobotReservationFunction = backend.createRobotReservation.resources.lambda;
const listRobotReservationsFunction = backend.listRobotReservations.resources.lambda;
const cancelRobotReservationFunction = backend.cancelRobotReservation.resources.lambda;
const checkRobotAvailabilityFunction = backend.checkRobotAvailability.resources.lambda;
const manageRobotAvailabilityFunction = backend.manageRobotAvailability.resources.lambda;

// Create Robot Reservation Lambda environment variables and permissions
const createRobotReservationCdkFunction = createRobotReservationFunction as CdkFunction;
createRobotReservationCdkFunction.addEnvironment('ROBOT_RESERVATION_TABLE', tables.RobotReservation.tableName);
createRobotReservationCdkFunction.addEnvironment('ROBOT_AVAILABILITY_TABLE', tables.RobotAvailability.tableName);
createRobotReservationCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
createRobotReservationCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
createRobotReservationCdkFunction.addEnvironment('PLATFORM_SETTINGS_TABLE', tables.PlatformSettings.tableName);
createRobotReservationCdkFunction.addEnvironment('PARTNER_PAYOUT_TABLE', tables.PartnerPayout.tableName);
createRobotReservationCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotReservation.grantReadWriteData(createRobotReservationFunction);
tables.RobotAvailability.grantReadData(createRobotReservationFunction);
tables.Robot.grantReadData(createRobotReservationFunction);
tables.UserCredits.grantReadWriteData(createRobotReservationFunction);
tables.PlatformSettings.grantReadData(createRobotReservationFunction);
tables.PartnerPayout.grantWriteData(createRobotReservationFunction);
// Grant permission to query indexes
createRobotReservationFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.Robot.tableArn}/index/robotIdIndex`,
    `${tables.RobotReservation.tableArn}/index/robotIdIndex`,
    `${tables.RobotAvailability.tableArn}/index/robotIdIndex`,
    `${tables.UserCredits.tableArn}/index/userIdIndex`,
    `${tables.PlatformSettings.tableArn}/index/settingKeyIndex`,
  ],
}));
// Grant Cognito permission to get user email
userPool.grant(createRobotReservationFunction, 'cognito-idp:AdminGetUser');

// List Robot Reservations Lambda environment variables and permissions
const listRobotReservationsCdkFunction = listRobotReservationsFunction as CdkFunction;
listRobotReservationsCdkFunction.addEnvironment('ROBOT_RESERVATION_TABLE', tables.RobotReservation.tableName);
listRobotReservationsCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
listRobotReservationsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotReservation.grantReadData(listRobotReservationsFunction);
tables.Robot.grantReadData(listRobotReservationsFunction);
// Grant permission to query indexes
listRobotReservationsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:Scan"],
  resources: [
    `${tables.RobotReservation.tableArn}/index/robotIdIndex`,
    `${tables.RobotReservation.tableArn}/index/userIdIndex`,
    `${tables.RobotReservation.tableArn}/index/partnerIdIndex`,
    `${tables.Robot.tableArn}/index/robotIdIndex`,
  ],
}));
// Grant Cognito permission to get user groups (for admin check)
userPool.grant(listRobotReservationsFunction, 'cognito-idp:AdminGetUser');

// Cancel Robot Reservation Lambda environment variables and permissions
const cancelRobotReservationCdkFunction = cancelRobotReservationFunction as CdkFunction;
cancelRobotReservationCdkFunction.addEnvironment('ROBOT_RESERVATION_TABLE', tables.RobotReservation.tableName);
cancelRobotReservationCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
cancelRobotReservationCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotReservation.grantReadWriteData(cancelRobotReservationFunction);
tables.UserCredits.grantReadWriteData(cancelRobotReservationFunction);
// Grant Cognito permission to get user groups (for admin check)
userPool.grant(cancelRobotReservationFunction, 'cognito-idp:AdminGetUser');

// Check Robot Availability Lambda environment variables and permissions
const checkRobotAvailabilityCdkFunction = checkRobotAvailabilityFunction as CdkFunction;
checkRobotAvailabilityCdkFunction.addEnvironment('ROBOT_RESERVATION_TABLE', tables.RobotReservation.tableName);
checkRobotAvailabilityCdkFunction.addEnvironment('ROBOT_AVAILABILITY_TABLE', tables.RobotAvailability.tableName);
tables.RobotReservation.grantReadData(checkRobotAvailabilityFunction);
tables.RobotAvailability.grantReadData(checkRobotAvailabilityFunction);
// Grant permission to query indexes
checkRobotAvailabilityFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.RobotReservation.tableArn}/index/robotIdIndex`,
    `${tables.RobotAvailability.tableArn}/index/robotIdIndex`,
  ],
}));

// Manage Robot Availability Lambda environment variables and permissions
const manageRobotAvailabilityCdkFunction = manageRobotAvailabilityFunction as CdkFunction;
manageRobotAvailabilityCdkFunction.addEnvironment('ROBOT_AVAILABILITY_TABLE', tables.RobotAvailability.tableName);
manageRobotAvailabilityCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
manageRobotAvailabilityCdkFunction.addEnvironment('ROBOT_RESERVATION_TABLE', tables.RobotReservation.tableName);
manageRobotAvailabilityCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotAvailability.grantReadWriteData(manageRobotAvailabilityFunction);
tables.Robot.grantReadData(manageRobotAvailabilityFunction);
tables.RobotReservation.grantReadData(manageRobotAvailabilityFunction);
// Grant permission to query indexes
manageRobotAvailabilityFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.Robot.tableArn}/index/robotIdIndex`,
    `${tables.RobotAvailability.tableArn}/index/robotIdIndex`,
    `${tables.RobotReservation.tableArn}/index/robotIdIndex`,
  ],
}));
// Grant Cognito permission to get user groups (for admin check)
userPool.grant(manageRobotAvailabilityFunction, 'cognito-idp:AdminGetUser');

// Process Robot Reservation Refunds Lambda environment variables and permissions
const processRobotReservationRefundsFunction = backend.processRobotReservationRefunds.resources.lambda;
const processRobotReservationRefundsCdkFunction = processRobotReservationRefundsFunction as CdkFunction;
processRobotReservationRefundsCdkFunction.addEnvironment('ROBOT_RESERVATION_TABLE', tables.RobotReservation.tableName);
processRobotReservationRefundsCdkFunction.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
processRobotReservationRefundsCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
processRobotReservationRefundsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.RobotReservation.grantReadWriteData(processRobotReservationRefundsFunction);
robotPresenceTable.grantReadData(processRobotReservationRefundsFunction);
tables.UserCredits.grantReadWriteData(processRobotReservationRefundsFunction);
// Grant permission to query indexes
processRobotReservationRefundsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.RobotReservation.tableArn}/index/statusIndex`,
  ],
}));
// Grant Cognito permission to get user groups (for admin check)
userPool.grant(processRobotReservationRefundsFunction, 'cognito-idp:AdminGetUser');

// List Partner Payouts Lambda environment variables and permissions
const listPartnerPayoutsFunction = backend.listPartnerPayouts.resources.lambda;
const listPartnerPayoutsCdkFunction = listPartnerPayoutsFunction as CdkFunction;
listPartnerPayoutsCdkFunction.addEnvironment('PARTNER_PAYOUT_TABLE', tables.PartnerPayout.tableName);
listPartnerPayoutsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.PartnerPayout.grantReadData(listPartnerPayoutsFunction);
// Grant permission to query indexes
listPartnerPayoutsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:Scan"],
  resources: [
    `${tables.PartnerPayout.tableArn}/index/partnerIdIndex`,
    `${tables.PartnerPayout.tableArn}/index/statusIndex`,
    `${tables.PartnerPayout.tableArn}/index/createdAtIndex`,
  ],
}));
// Grant Cognito permission to get user info
userPool.grant(listPartnerPayoutsFunction, 'cognito-idp:AdminGetUser');

// Admin audit table - tracks all admin assignments/removals and credit adjustments
const adminAuditTable = new Table(dataStack, 'AdminAuditTable', {
  partitionKey: { name: 'id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // For sandbox/dev
});
// Add GSIs for admin and target user lookups
adminAuditTable.addGlobalSecondaryIndex({
  indexName: 'adminUserIdIndex',
  partitionKey: { name: 'adminUserId', type: AttributeType.STRING },
});
adminAuditTable.addGlobalSecondaryIndex({
  indexName: 'targetUserIdIndex',
  partitionKey: { name: 'targetUserId', type: AttributeType.STRING },
});
// GSI for efficient timestamp-based queries
// Uses constant partition key "AUDIT" + timestamp as sort key
// This allows Query (cheap) instead of Scan (expensive)
adminAuditTable.addGlobalSecondaryIndex({
  indexName: 'timestampIndexV2',
  partitionKey: { name: 'logType', type: AttributeType.STRING }, // Constant: "AUDIT"
  sortKey: { name: 'timestamp', type: AttributeType.STRING }, // ISO timestamp for sorting
});

// Grant deleteRobotLambda permissions to adminAuditTable (after table is declared)
backend.deleteRobotLambda.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
adminAuditTable.grantWriteData(backend.deleteRobotLambda.resources.lambda);
userPool.grant(backend.deleteRobotLambda.resources.lambda, 'cognito-idp:AdminGetUser');

// Now set ADMIN_AUDIT_TABLE environment variable and permissions for addCredits function
addCreditsCdkFunction.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
adminAuditTable.grantWriteData(addCreditsFunction);

// Set ADMIN_AUDIT_TABLE environment variable and permissions for setUserGroupLambda
backend.setUserGroupLambda.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
adminAuditTable.grantWriteData(backend.setUserGroupLambda.resources.lambda);

// Assign admin Lambda environment variables and permissions
const assignAdminCdkFunction = assignAdminFunction as CdkFunction;
assignAdminCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
assignAdminCdkFunction.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
userPool.grant(assignAdminFunction, 'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminListGroupsForUser');
adminAuditTable.grantWriteData(assignAdminFunction);

// Remove admin Lambda environment variables and permissions
const removeAdminCdkFunction = removeAdminFunction as CdkFunction;
removeAdminCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
removeAdminCdkFunction.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
userPool.grant(removeAdminFunction, 'cognito-idp:AdminRemoveUserFromGroup', 'cognito-idp:AdminListGroupsForUser', 'cognito-idp:ListUsersInGroup');
adminAuditTable.grantWriteData(removeAdminFunction);

// List admins Lambda environment variables and permissions
const listAdminsCdkFunction = listAdminsFunction as CdkFunction;
listAdminsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
userPool.grant(listAdminsFunction, 'cognito-idp:ListUsersInGroup');

// List users Lambda environment variables and permissions
const listUsersCdkFunction = listUsersFunction as CdkFunction;
listUsersCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
listUsersCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
listUsersCdkFunction.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);
listUsersCdkFunction.addEnvironment('CLIENT_TABLE_NAME', tables.Client.tableName);
userPool.grant(listUsersFunction, 'cognito-idp:ListUsers', 'cognito-idp:ListUsersInGroup', 'cognito-idp:AdminGetUser');
tables.UserCredits.grantReadData(listUsersFunction);
tables.Partner.grantReadData(listUsersFunction);
tables.Client.grantReadData(listUsersFunction);
// Grant permission to query the userIdIndex
listUsersFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:Scan"],
  resources: [
    `${tables.UserCredits.tableArn}/index/userIdIndex`,
    `${tables.Partner.tableArn}`,
    `${tables.Client.tableArn}`,
  ],
}));

// Get system stats Lambda environment variables and permissions
const getSystemStatsCdkFunction = getSystemStatsFunction as CdkFunction;
getSystemStatsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
getSystemStatsCdkFunction.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
getSystemStatsCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);
getSystemStatsCdkFunction.addEnvironment('USER_CREDITS_TABLE', tables.UserCredits.tableName);
getSystemStatsCdkFunction.addEnvironment('CREDIT_TRANSACTIONS_TABLE', tables.CreditTransaction.tableName);
getSystemStatsCdkFunction.addEnvironment('PARTNER_PAYOUT_TABLE', tables.PartnerPayout.tableName);
userPool.grant(getSystemStatsFunction, 'cognito-idp:ListUsers', 'cognito-idp:AdminGetUser');
tables.Robot.grantReadData(getSystemStatsFunction);
tables.Session.grantReadData(getSystemStatsFunction);
tables.UserCredits.grantReadData(getSystemStatsFunction);
tables.CreditTransaction.grantReadData(getSystemStatsFunction);
tables.PartnerPayout.grantReadData(getSystemStatsFunction);

// List audit logs Lambda environment variables and permissions
const listAuditLogsCdkFunction = listAuditLogsFunction as CdkFunction;
listAuditLogsCdkFunction.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
listAuditLogsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
adminAuditTable.grantReadData(listAuditLogsFunction);
userPool.grant(listAuditLogsFunction, 'cognito-idp:AdminGetUser');
// Grant permission to query the indexes
listAuditLogsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:Scan"],
  resources: [
    `${adminAuditTable.tableArn}/index/adminUserIdIndex`,
    `${adminAuditTable.tableArn}/index/targetUserIdIndex`,
    `${adminAuditTable.tableArn}/index/timestampIndexV2`, // New efficient GSI
    adminAuditTable.tableArn, // For fallback Scan
  ],
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

// Process Payout Lambda configuration
const processPayoutFunction = backend.processPayout.resources.lambda;
const processPayoutCdkFunction = processPayoutFunction as CdkFunction;
processPayoutCdkFunction.addEnvironment('PARTNER_PAYOUT_TABLE', tables.PartnerPayout.tableName);
processPayoutCdkFunction.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
processPayoutCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);
tables.PartnerPayout.grantReadWriteData(processPayoutFunction);
adminAuditTable.grantWriteData(processPayoutFunction);
userPool.grant(processPayoutFunction, 'cognito-idp:AdminGetUser');

// ============================================
// Connection Cleanup Lambda Function
// ============================================

const cleanupStaleConnectionsFunction = backend.cleanupStaleConnections.resources.lambda;
const cleanupStaleConnectionsCdkFunction = cleanupStaleConnectionsFunction as CdkFunction;

// Set environment variables
cleanupStaleConnectionsCdkFunction.addEnvironment('CONN_TABLE', connTable.tableName);
cleanupStaleConnectionsCdkFunction.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
cleanupStaleConnectionsCdkFunction.addEnvironment('SESSION_TABLE_NAME', tables.Session.tableName);
// Construct WebSocket Management API endpoint (same as signaling function)
const wsMgmtEndpoint = `https://${wsApi.apiId}.execute-api.${dataStack.region}.amazonaws.com/${wsStage.stageName}`;
cleanupStaleConnectionsCdkFunction.addEnvironment('WS_MGMT_ENDPOINT', wsMgmtEndpoint);

// Grant permissions
connTable.grantReadWriteData(cleanupStaleConnectionsFunction);
robotPresenceTable.grantReadWriteData(cleanupStaleConnectionsFunction);
tables.Session.grantReadWriteData(cleanupStaleConnectionsFunction);

// Grant permission to query the connectionIdIndex GSI
cleanupStaleConnectionsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${tables.Session.tableArn}/index/connectionIdIndex`,
  ],
}));

// Grant permission to send messages via WebSocket Management API
cleanupStaleConnectionsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["execute-api:ManageConnections"],
  resources: [`arn:aws:execute-api:${dataStack.region}:${dataStack.account}:${wsApi.apiId}/*/*`],
}));

// Create EventBridge rule to trigger cleanup every hour
const cleanupRule = new Rule(backend.stack, 'CleanupStaleConnectionsRule', {
  schedule: Schedule.rate(Duration.hours(1)), // Run every hour
  description: 'Trigger cleanup of stale WebSocket connections',
});

// Add Lambda as target
cleanupRule.addTarget(new LambdaFunction(cleanupStaleConnectionsFunction));

// ============================================
// WebSocket Keepalive Lambda Function
// ============================================

const websocketKeepaliveFunction = backend.websocketKeepalive.resources.lambda;
const websocketKeepaliveCdkFunction = websocketKeepaliveFunction as CdkFunction;

// Set environment variables
websocketKeepaliveCdkFunction.addEnvironment('CONN_TABLE', connTable.tableName);
// Construct WebSocket Management API endpoint (same as signaling function)
websocketKeepaliveCdkFunction.addEnvironment('WS_MGMT_ENDPOINT', wsMgmtEndpoint);

// Grant permissions
connTable.grantReadData(websocketKeepaliveFunction);

// Grant permission to send messages via WebSocket Management API
websocketKeepaliveFunction.addToRolePolicy(new PolicyStatement({
  actions: ["execute-api:ManageConnections"],
  resources: [`arn:aws:execute-api:${dataStack.region}:${dataStack.account}:${wsApi.apiId}/*/*`],
}));

// Create EventBridge rule to trigger keepalive every 5 minutes
// This ensures connections stay alive before the 10-minute AWS timeout
const keepaliveRule = new Rule(backend.stack, 'WebSocketKeepaliveRule', {
  schedule: Schedule.rate(Duration.minutes(5)), // Run every 5 minutes
  description: 'Send keepalive pings to all active WebSocket connections to prevent idle timeout',
});

// Add Lambda as target
keepaliveRule.addTarget(new LambdaFunction(websocketKeepaliveCdkFunction));

// ============================================
// Trigger Connection Cleanup Lambda Function
// ============================================

const triggerConnectionCleanupFunction = backend.triggerConnectionCleanup.resources.lambda;
const triggerConnectionCleanupCdkFunction = triggerConnectionCleanupFunction as CdkFunction;

// Set environment variable with cleanup function name
triggerConnectionCleanupCdkFunction.addEnvironment(
  'CLEANUP_FUNCTION_NAME',
  cleanupStaleConnectionsFunction.functionName
);

// Grant permission to invoke cleanup function
cleanupStaleConnectionsFunction.grantInvoke(triggerConnectionCleanupFunction);

// ============================================
// Get Active Robots Lambda Function
// ============================================

const getActiveRobotsFunction = backend.getActiveRobots.resources.lambda;
const getActiveRobotsCdkFunction = getActiveRobotsFunction as CdkFunction;

// Set environment variables
getActiveRobotsCdkFunction.addEnvironment('ROBOT_PRESENCE_TABLE', robotPresenceTable.tableName);
getActiveRobotsCdkFunction.addEnvironment('CONN_TABLE', connTable.tableName);
getActiveRobotsCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);

// Grant read permissions
robotPresenceTable.grantReadData(getActiveRobotsFunction);
connTable.grantReadData(getActiveRobotsFunction);

// Grant Cognito permission to get user email
userPool.grant(getActiveRobotsFunction, 'cognito-idp:AdminGetUser');

// Manage Credit Tier Lambda
const manageCreditTierFunction = backend.manageCreditTier.resources.lambda;
const manageCreditTierCdkFunction = manageCreditTierFunction as CdkFunction;

// Set environment variables
manageCreditTierCdkFunction.addEnvironment('CREDIT_TIER_TABLE', tables.CreditTier.tableName);
manageCreditTierCdkFunction.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);
manageCreditTierCdkFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);

// Grant DynamoDB permissions
tables.CreditTier.grantReadWriteData(manageCreditTierFunction);
adminAuditTable.grantWriteData(manageCreditTierFunction);

// Grant Cognito permission to get user email
userPool.grant(manageCreditTierFunction, 'cognito-idp:AdminGetUser');

// ============================================
// Cleanup Audit Logs Lambda Function
// ============================================

const cleanupAuditLogsFunction = backend.cleanupAuditLogs.resources.lambda;
const cleanupAuditLogsCdkFunction = cleanupAuditLogsFunction as CdkFunction;

// Set environment variables
cleanupAuditLogsCdkFunction.addEnvironment('ADMIN_AUDIT_TABLE', adminAuditTable.tableName);

// Grant permissions
adminAuditTable.grantReadWriteData(cleanupAuditLogsFunction);

// Grant permission to query the timestampIndexV2 GSI
cleanupAuditLogsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query"],
  resources: [
    `${adminAuditTable.tableArn}/index/timestampIndexV2`,
  ],
}));

// Create EventBridge rule to trigger cleanup monthly (on the 1st at 2 AM UTC)
const auditCleanupRule = new Rule(backend.stack, 'CleanupAuditLogsRule', {
  schedule: Schedule.cron({ minute: '0', hour: '2', day: '1', month: '*', year: '*' }), // Monthly on 1st at 2 AM UTC
  description: 'Trigger cleanup of old audit logs (keep last 5000 records)',
});

// Add Lambda as target
auditCleanupRule.addTarget(new LambdaFunction(cleanupAuditLogsFunction));
