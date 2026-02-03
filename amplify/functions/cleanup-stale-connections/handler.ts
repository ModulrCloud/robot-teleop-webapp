import {
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
  QueryCommand,
  UpdateItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { buildAgentPingMessage } from '../shared/agent-protocol';

const CONN_TABLE = process.env.CONN_TABLE!;
const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME;
const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT!;

const db = new DynamoDBClient({});
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT });

// Connections older than 1 hour (in milliseconds)
const STALE_CONNECTION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Batching: stay within Lambda 15 min limit; target 10 min run
const MAX_RUN_SECONDS = 600; // 10 minutes
const WAIT_PER_BATCH_SEC = 10;
const MAX_BATCHES = Math.floor(MAX_RUN_SECONDS / WAIT_PER_BATCH_SEC); // 60 batches
const MIN_BATCH_SIZE = 25;

interface CleanupStats {
  totalConnections: number;
  staleConnections: number;
  cleanedConnections: number;
  cleanedRobotPresence: number;
  cleanedSessions: number;
  errors: number;
}

interface StaleConnection {
  connectionId: string;
  kind: string | undefined;
}

/**
 * Collects all stale connection records (ts older than 1 hour).
 */
async function collectStaleConnections(thresholdTimestamp: number): Promise<StaleConnection[]> {
  const stale: StaleConnection[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const scanResult = await db.send(
      new ScanCommand({
        TableName: CONN_TABLE,
        ExclusiveStartKey: lastEvaluatedKey,
        FilterExpression: 'ts < :threshold',
        ExpressionAttributeValues: {
          ':threshold': { N: String(thresholdTimestamp) },
        },
        ProjectionExpression: 'connectionId, #kind',
        ExpressionAttributeNames: { '#kind': 'kind' },
        Limit: 100,
      })
    );

    for (const item of scanResult.Items || []) {
      const connectionId = item.connectionId?.S;
      if (!connectionId) continue;
      // FilterExpression already ensures ts < threshold
      stale.push({
        connectionId,
        kind: item.kind?.S,
      });
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return stale;
}

/**
 * Sends agent.ping to a connection. Returns true if sent successfully, false if connection is dead (GoneException).
 */
async function sendAgentPing(connectionId: string): Promise<boolean> {
  try {
    const message = buildAgentPingMessage();
    await mgmt.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message), 'utf-8'),
      })
    );
    return true;
  } catch (error: any) {
    if (error?.name === 'GoneException' || error?.Code === 'GoneException') {
      return false;
    }
    console.warn(`[CLEANUP] Error pinging connection ${connectionId}:`, error?.name || error?.message);
    return true; // Assume alive to avoid false positives
  }
}

/**
 * Cleans up robot presence record for a stale robot connection.
 */
async function cleanupRobotPresence(connectionId: string): Promise<void> {
  const result = await db.send(
    new ScanCommand({
      TableName: ROBOT_PRESENCE_TABLE,
      FilterExpression: 'connectionId = :connId',
      ExpressionAttributeValues: { ':connId': { S: connectionId } },
    })
  );

  for (const item of result.Items || []) {
    const robotId = item.robotId?.S;
    if (robotId) {
      await db.send(
        new DeleteItemCommand({
          TableName: ROBOT_PRESENCE_TABLE,
          Key: { robotId: { S: robotId } },
        })
      );
      console.log(`[CLEANUP] Deleted robot presence for robot ${robotId} (connection ${connectionId})`);
    }
  }
}

/**
 * Cleans up active sessions for a stale connection.
 */
async function cleanupConnectionSessions(connectionId: string): Promise<void> {
  if (!SESSION_TABLE_NAME) return;

  const result = await db.send(
    new QueryCommand({
      TableName: SESSION_TABLE_NAME,
      IndexName: 'connectionIdIndex',
      KeyConditionExpression: 'connectionId = :connId',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':connId': { S: connectionId },
        ':active': { S: 'active' },
      },
    })
  );

  for (const item of result.Items || []) {
    const sessionId = item.id?.S;
    if (!sessionId) continue;

    try {
      const sessionResult = await db.send(
        new GetItemCommand({
          TableName: SESSION_TABLE_NAME,
          Key: { id: { S: sessionId } },
        })
      );

      if (!sessionResult.Item) continue;

      const now = new Date().toISOString();
      const startedAt = sessionResult.Item.startedAt?.S;
      let durationSeconds = 0;
      if (startedAt) {
        durationSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      }

      await db.send(
        new UpdateItemCommand({
          TableName: SESSION_TABLE_NAME,
          Key: { id: { S: sessionId } },
          UpdateExpression: 'SET #status = :completed, endedAt = :endedAt, durationSeconds = :duration, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':completed': { S: 'completed' },
            ':endedAt': { S: now },
            ':duration': { N: String(durationSeconds) },
            ':now': { S: now },
          },
        })
      );
      console.log(`[CLEANUP] Ended session ${sessionId} for stale connection ${connectionId}`);
    } catch (error) {
      console.error(`[CLEANUP] Failed to end session ${sessionId}:`, error);
    }
  }
}

/**
 * Deletes a stale connection and all associated records.
 */
async function cleanupStaleConnection(
  conn: StaleConnection,
  stats: CleanupStats
): Promise<void> {
  try {
    if (conn.kind !== 'monitor') {
      await cleanupRobotPresence(conn.connectionId);
      stats.cleanedRobotPresence++;
    }

    await cleanupConnectionSessions(conn.connectionId);
    stats.cleanedSessions++;

    await db.send(
      new DeleteItemCommand({
        TableName: CONN_TABLE,
        Key: { connectionId: { S: conn.connectionId } },
      })
    );

    stats.cleanedConnections++;
    console.log(`[CLEANUP] Cleaned up stale connection ${conn.connectionId} (kind: ${conn.kind || 'unknown'})`);
  } catch (error) {
    stats.errors++;
    console.error(`[CLEANUP] Failed to cleanup connection ${conn.connectionId}:`, error);
  }
}

/**
 * Main cleanup handler - runs on schedule (every hour).
 * Processes stale connections in batches to stay within 10 min limit.
 * Batch size scales with connection count: min 25, sized for ~60 batches in 10 min.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  console.log('[CLEANUP] Starting stale connection cleanup job');
  const startTime = Date.now();

  const stats: CleanupStats = {
    totalConnections: 0,
    staleConnections: 0,
    cleanedConnections: 0,
    cleanedRobotPresence: 0,
    cleanedSessions: 0,
    errors: 0,
  };

  try {
    const thresholdTimestamp = Date.now() - STALE_CONNECTION_THRESHOLD_MS;
    const staleConnections = await collectStaleConnections(thresholdTimestamp);
    stats.staleConnections = staleConnections.length;

    if (staleConnections.length === 0) {
      const duration = Date.now() - startTime;
      console.log('[CLEANUP] No stale connections found', { duration: `${duration}ms` });
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No stale connections', stats, duration: `${duration}ms` }),
      };
    }

    // Scale batch size: min 25, max batches = 60 in 10 min
    const batchSize = Math.max(MIN_BATCH_SIZE, Math.ceil(staleConnections.length / MAX_BATCHES));
    const batches: StaleConnection[][] = [];
    for (let i = 0; i < staleConnections.length; i += batchSize) {
      batches.push(staleConnections.slice(i, i + batchSize));
    }

    console.log('[CLEANUP] Processing stale connections', {
      total: staleConnections.length,
      batchSize,
      batchCount: batches.length,
    });

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const toCleanup: StaleConnection[] = [];

      // Send agent.ping to each connection in batch
      const results = await Promise.allSettled(
        batch.map((conn) => sendAgentPing(conn.connectionId))
      );

      for (let i = 0; i < batch.length; i++) {
        const conn = batch[i];
        const result = results[i];
        if (result.status === 'fulfilled' && !result.value) {
          // PostToConnection failed (GoneException) - connection is dead
          toCleanup.push(conn);
        }
        // If fulfilled && value=true, connection is alive - skip cleanup
        // If rejected, we assume alive (avoid false positives)
      }

      // Wait for pong window (future: check lastPongAt here)
      await new Promise((r) => setTimeout(r, WAIT_PER_BATCH_SEC * 1000));

      // Clean up dead connections
      for (const conn of toCleanup) {
        await cleanupStaleConnection(conn, stats);
      }
    }

    const duration = Date.now() - startTime;
    console.log('[CLEANUP] Cleanup job completed', { duration: `${duration}ms`, ...stats });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Cleanup job completed', stats, duration: `${duration}ms` }),
    };
  } catch (error) {
    stats.errors++;
    console.error('[CLEANUP] Cleanup job failed:', error);
    const duration = Date.now() - startTime;
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Cleanup job failed',
        message: error instanceof Error ? error.message : String(error),
        stats,
        duration: `${duration}ms`,
      }),
    };
  }
};
