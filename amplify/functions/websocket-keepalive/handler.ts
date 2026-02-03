import { randomUUID } from 'crypto';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const CONN_TABLE = process.env.CONN_TABLE!;
const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT!;

const db = new DynamoDBClient({});
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT });

interface KeepaliveStats {
  totalConnections: number;
  successfulPings: number;
  failedPings: number;
  errors: number;
}

const PROTOCOL_VERSION = '0.0';

/**
 * Builds an agent.ping message per Modulr Agent Interface Specification.
 * @see interface-spec/modulr-agent-interface-spec-main/schemas/agent/v0/ping.json
 */
function buildAgentPingMessage(): object {
  return {
    type: 'agent.ping',
    version: PROTOCOL_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Sends an agent.ping message to a WebSocket connection to keep it alive.
 * Uses the Modulr Agent Interface Specification format (agent.ping).
 * Returns true if ping was successful, false otherwise.
 */
async function sendKeepalivePing(connectionId: string): Promise<boolean> {
  try {
    const message = buildAgentPingMessage();
    await mgmt.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message), 'utf-8'),
      })
    );
    return true; // Ping successful
  } catch (error: any) {
    // GoneException means the connection is dead (expected for some connections)
    if (error?.name === 'GoneException' || error?.Code === 'GoneException') {
      // This is expected - connection was already closed, not an error
      return false;
    }
    // Other errors (e.g., network issues) - log but don't count as failure
    console.warn(`[KEEPALIVE] Error pinging connection ${connectionId}:`, error?.name || error?.message);
    return false;
  }
}

/**
 * Keepalive Lambda that runs on schedule to send agent.ping messages to all active WebSocket connections.
 * Uses the Modulr Agent Interface Specification format for compatibility with the robot agent.
 * This prevents AWS API Gateway from closing connections due to 10-minute idle timeout.
 *
 * Runs every 5 minutes to ensure connections stay alive before the 10-minute timeout.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  console.log('[WEBSOCKET_KEEPALIVE] Starting keepalive job');
  const startTime = Date.now();

  const stats: KeepaliveStats = {
    totalConnections: 0,
    successfulPings: 0,
    failedPings: 0,
    errors: 0,
  };

  try {
    // Scan all connections from the connections table
    let lastEvaluatedKey: any = undefined;
    let scanCount = 0;
    const maxScans = 10; // Limit to prevent infinite loops

    do {
      const scanResult = await db.send(
        new ScanCommand({
          TableName: CONN_TABLE,
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: 100, // Process in batches of 100
        })
      );

      const connections = scanResult.Items || [];
      stats.totalConnections += connections.length;

      // Send ping to each connection
      const pingPromises = connections.map(async (item) => {
        const connectionId = item.connectionId?.S;
        if (!connectionId) {
          stats.errors++;
          return;
        }

        const success = await sendKeepalivePing(connectionId);
        if (success) {
          stats.successfulPings++;
        } else {
          stats.failedPings++;
        }
      });

      await Promise.allSettled(pingPromises);

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      scanCount++;

      // Safety check to prevent infinite loops
      if (scanCount >= maxScans) {
        console.warn('[WEBSOCKET_KEEPALIVE] Reached max scan limit, stopping');
        break;
      }
    } while (lastEvaluatedKey);

    const duration = Date.now() - startTime;

    console.log('[WEBSOCKET_KEEPALIVE] Keepalive job completed', {
      duration: `${duration}ms`,
      ...stats,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        duration: `${duration}ms`,
        ...stats,
      }),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[WEBSOCKET_KEEPALIVE] Keepalive job failed', {
      error: error instanceof Error ? error.message : String(error),
      duration: `${duration}ms`,
      ...stats,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: `${duration}ms`,
        ...stats,
      }),
    };
  }
};

