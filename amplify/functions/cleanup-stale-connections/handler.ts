import type { AttributeValue } from '@aws-sdk/client-dynamodb';
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
// Set PONG_CHECK_ENABLED=true to require agent.pong for robot liveness (agent must support it)
const PONG_CHECK_ENABLED = process.env.PONG_CHECK_ENABLED === 'true';

const db = new DynamoDBClient({});
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT });

// Connections older than 1 hour (in milliseconds)
const STALE_CONNECTION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Batching: stay within Lambda 15 min limit; target 10 min run
const MAX_RUN_SECONDS = 600; // 10 minutes
const WAIT_PER_BATCH_SEC = 10;
const PONG_RETRY_COUNT = 1; // Retry ping once before marking dead
// With retry: 2 pings + 2 waits per batch = 2 * WAIT_PER_BATCH_SEC extra, so ~30 batches max
const MAX_BATCHES = Math.floor(MAX_RUN_SECONDS / (WAIT_PER_BATCH_SEC * (1 + PONG_RETRY_COUNT)));
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
 * Builds a Set of connectionIds that are robots (in ROBOT_PRESENCE_TABLE).
 * Used to determine which connections require pong for liveness.
 */
async function getRobotConnectionIds(): Promise<Set<string>> {
  const robotConnIds = new Set<string>();
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

  do {
    const result = await db.send(
      new ScanCommand({
        TableName: ROBOT_PRESENCE_TABLE,
        ProjectionExpression: 'connectionId',
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 100,
      })
    );

    for (const item of result.Items || []) {
      const connId = item.connectionId?.S;
      if (connId) robotConnIds.add(connId);
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return robotConnIds;
}

/**
 * Fetches lastPongAt from CONN_TABLE for a connection.
 */
async function getLastPongAt(connectionId: string): Promise<number | null> {
  try {
    const result = await db.send(
      new GetItemCommand({
        TableName: CONN_TABLE,
        Key: { connectionId: { S: connectionId } },
        ProjectionExpression: 'lastPongAt',
      })
    );
    const val = result.Item?.lastPongAt?.N;
    return val != null ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Cleans up orphaned ROBOT_PRESENCE_TABLE entries - presence records whose connectionId
 * no longer exists in CONN_TABLE. These occur when $disconnect removed the connection
 * but presence wasn't cleaned (e.g. network drop before fix, or $disconnect race).
 */
async function cleanupOrphanedRobotPresence(stats: CleanupStats): Promise<void> {
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

  do {
    const result = await db.send(
      new ScanCommand({
        TableName: ROBOT_PRESENCE_TABLE,
        ProjectionExpression: 'robotId, connectionId',
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 50,
      })
    );

    for (const item of result.Items || []) {
      const robotId = item.robotId?.S;
      const connectionId = item.connectionId?.S;
      if (!robotId || !connectionId) continue;

      const connExists = await db.send(
        new GetItemCommand({
          TableName: CONN_TABLE,
          Key: { connectionId: { S: connectionId } },
          ProjectionExpression: 'connectionId',
        })
      );

      if (!connExists.Item) {
        await db.send(
          new DeleteItemCommand({
            TableName: ROBOT_PRESENCE_TABLE,
            Key: { robotId: { S: robotId } },
          })
        );
        stats.cleanedRobotPresence++;
        console.log(`[CLEANUP] Deleted orphaned robot presence: robot ${robotId} (connection ${connectionId} not in CONN_TABLE)`);
      }
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}

/**
 * Collects all stale connection records (ts older than 1 hour).
 */
async function collectStaleConnections(thresholdTimestamp: number): Promise<StaleConnection[]> {
  const stale: StaleConnection[] = [];
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

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
  } catch (error: unknown) {
    const err = error as { name?: string; Code?: string; message?: string };
    if (err?.name === 'GoneException' || err?.Code === 'GoneException') {
      return false;
    }
    console.warn(`[CLEANUP] Error pinging connection ${connectionId}:`, err?.name || err?.message);
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
    // First: clean orphaned ROBOT_PRESENCE entries (connectionId no longer in CONN_TABLE)
    await cleanupOrphanedRobotPresence(stats);

    const thresholdTimestamp = Date.now() - STALE_CONNECTION_THRESHOLD_MS;
    const staleConnections = await collectStaleConnections(thresholdTimestamp);
    stats.staleConnections = staleConnections.length;

    if (staleConnections.length === 0) {
      const duration = Date.now() - startTime;
      const orphanCount = stats.cleanedRobotPresence;
      const msg = orphanCount > 0
        ? `No stale connections in CONN_TABLE; cleaned ${orphanCount} orphaned robot presence entries.`
        : 'No stale connections';
      console.log('[CLEANUP]', msg, { duration: `${duration}ms`, ...stats });
      return {
        statusCode: 200,
        body: JSON.stringify({ message: msg, stats, duration: `${duration}ms` }),
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

    // Build set of robot connectionIds - only robots require pong when enabled
    const robotConnectionIds = PONG_CHECK_ENABLED ? await getRobotConnectionIds() : new Set<string>();
    console.log('[CLEANUP] Pong check enabled:', PONG_CHECK_ENABLED, 'robot connections:', robotConnectionIds.size);

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const toCleanup: StaleConnection[] = [];
      let pingSentAt = Date.now();

      // Send agent.ping to each connection in batch
      const results = await Promise.allSettled(
        batch.map((conn) => sendAgentPing(conn.connectionId))
      );

      const successfulPings: StaleConnection[] = [];
      for (let i = 0; i < batch.length; i++) {
        const conn = batch[i];
        const result = results[i];
        if (result.status === 'fulfilled' && !result.value) {
          toCleanup.push(conn);
        } else if (result.status === 'fulfilled' && result.value) {
          successfulPings.push(conn);
        }
      }

      // Wait for pong window
      await new Promise((r) => setTimeout(r, WAIT_PER_BATCH_SEC * 1000));

      // For robot connections (when pong check enabled): require pong. Otherwise: PostToConnection success = alive.
      const robotPings = PONG_CHECK_ENABLED
        ? successfulPings.filter((c) => robotConnectionIds.has(c.connectionId))
        : [];
      const noPongRobots: StaleConnection[] = [];

      if (PONG_CHECK_ENABLED) {
        for (const conn of robotPings) {
          const lastPongAt = await getLastPongAt(conn.connectionId);
          if (lastPongAt == null || lastPongAt < pingSentAt) {
            noPongRobots.push(conn);
          }
        }
      }

      // Retry: ping no-pong robots again (up to PONG_RETRY_COUNT times) - only when pong check enabled
      let retryCandidates = PONG_CHECK_ENABLED ? [...noPongRobots] : [];
      for (let retry = 0; retry < PONG_RETRY_COUNT && retryCandidates.length > 0; retry++) {
        pingSentAt = Date.now();
        const retryResults = await Promise.allSettled(
          retryCandidates.map((c) => sendAgentPing(c.connectionId))
        );
        const stillPingable: StaleConnection[] = [];
        for (let i = 0; i < retryCandidates.length; i++) {
          const r = retryResults[i];
          const pingSucceeded = r.status === 'fulfilled' ? r.value : false;
          if (pingSucceeded) {
            stillPingable.push(retryCandidates[i]);
          } else {
            toCleanup.push(retryCandidates[i]);
          }
        }
        if (stillPingable.length === 0) break;
        await new Promise((r) => setTimeout(r, WAIT_PER_BATCH_SEC * 1000));
        retryCandidates = [];
        for (const conn of stillPingable) {
          const lastPongAt = await getLastPongAt(conn.connectionId);
          if (lastPongAt == null || lastPongAt < pingSentAt) {
            retryCandidates.push(conn);
          }
          // If got pong, conn is alive - don't add to retryCandidates or toCleanup
        }
        // If fulfilled && value=true, connection is alive - skip cleanup
        // If rejected, we assume alive (avoid false positives)
      }
      for (const conn of retryCandidates) {
        toCleanup.push(conn);
      }

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
