/**
 * Set process.env for handler tests so the handler (which reads env at module load)
 * sees table names etc. Import this first in handler.test.ts so it runs before the handler.
 */
process.env.CONN_TABLE = 'LocalConnections';
process.env.ROBOT_PRESENCE_TABLE = 'LocalPresence';
process.env.ROBOT_TABLE_NAME = 'LocalRobots';
process.env.PARTNER_TABLE_NAME = 'LocalPartners';
process.env.REVOKED_TOKENS_TABLE = 'LocalRevokedTokens';
process.env.USER_INVALIDATION_TABLE = 'LocalUserInvalidation';
process.env.WS_MGMT_ENDPOINT = 'https://example.com/_aws/ws';
process.env.USER_POOL_ID = 'us-east-1_TestPool123';
process.env.AWS_REGION = 'us-east-1';
