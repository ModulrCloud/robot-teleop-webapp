import { DynamoDBClient, ScanCommand, DeleteItemCommand, QueryCommand, UpdateItemCommand, GetItemCommand, ScanCommandOutput } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const CONN_TABLE = process.env.CONN_TABLE!;
const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME;
const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT!;

const db = new DynamoDBClient({});
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT });

// Connections older than 1 hour (in milliseconds)
const STALE_CONNECTION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

interface CleanupStats {
  totalConnections: number;
  staleConnections: number;
  cleanedConnections: number;
  cleanedRobotPresence: number;
  cleanedSessions: number;
  errors: number;
}

/**
 * Attempts to send a ping to a WebSocket connection to check if it's alive.
 * Returns true if connection is alive, false if it's dead.
 */
async function isConnectionAlive(connectionId: string): Promise<boolean> {
  try {
    // Send a small ping message to test if connection is alive
    await mgmt.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify({ type: 'ping', timestamp: Date.now() }), 'utf-8'),
      })
    );
    return true; // Connection is alive
  } catch (error: any) {
    // GoneException means the connection is dead
    if (error?.name === 'GoneException' || error?.Code === 'GoneException') {
      return false;
    }
    // Other errors (e.g., network issues) - assume connection might be alive
    // Log but don't delete
    console.warn(`[CLEANUP] Error pinging connection ${connectionId}:`, error?.name || error?.message);
    return true; // Assume alive to avoid false positives
  }
}

/**
 * Cleans up robot presence record for a stale robot connection.
 */
async function cleanupRobotPresence(connectionId: string): Promise<void> {
  try {
    // Scan robot presence table for this connection
    const result = await db.send(
      new ScanCommand({
        TableName: ROBOT_PRESENCE_TABLE,
        FilterExpression: 'connectionId = :connId',
        ExpressionAttributeValues: {
          ':connId': { S: connectionId },
        },
      })
    );

    for (const item of result.Items || []) {
      const robotId = item.robotId?.S;
      if (robotId) {
        await db.send(
          new DeleteItemCommand({
            TableName: ROBOT_PRESENCE_TABLE,
            Key: {
              robotId: { S: robotId },
            },
          })
        );
        console.log(`[CLEANUP] Deleted robot presence for robot ${robotId} (connection ${connectionId})`);
      }
    }
  } catch (error) {
    console.error(`[CLEANUP] Failed to cleanup robot presence for connection ${connectionId}:`, error);
    throw error;
  }
}

/**
 * Cleans up active sessions for a stale connection.
 */
async function cleanupConnectionSessions(connectionId: string): Promise<void> {
  if (!SESSION_TABLE_NAME) return;

  try {
    // Query sessions by connectionId using GSI
    const result = await db.send(
      new QueryCommand({
        TableName: SESSION_TABLE_NAME,
        IndexName: 'connectionIdIndex',
        KeyConditionExpression: 'connectionId = :connId',
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':connId': { S: connectionId },
          ':active': { S: 'active' },
        },
      })
    );

    for (const item of result.Items || []) {
      const sessionId = item.id?.S;
      if (sessionId) {
        try {
          // Get session to calculate duration
          const sessionResult = await db.send(
            new GetItemCommand({
              TableName: SESSION_TABLE_NAME,
              Key: { id: { S: sessionId } },
            })
          );

          if (!sessionResult.Item) {
            console.warn(`[CLEANUP] Session ${sessionId} not found, skipping`);
            continue;
          }

          // Update session to completed status
          const now = new Date().toISOString();
          const startedAt = sessionResult.Item.startedAt?.S;
          let durationSeconds = 0;
          
          if (startedAt) {
            const startTime = new Date(startedAt).getTime();
            durationSeconds = Math.floor((Date.now() - startTime) / 1000);
          }

          await db.send(
            new UpdateItemCommand({
              TableName: SESSION_TABLE_NAME,
              Key: { id: { S: sessionId } },
              UpdateExpression: 'SET #status = :completed, endedAt = :endedAt, durationSeconds = :duration, updatedAt = :now',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
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
          // Continue with other sessions
        }
      }
    }
  } catch (error) {
    console.error(`[CLEANUP] Failed to cleanup sessions for connection ${connectionId}:`, error);
    // Don't throw - session cleanup failure shouldn't block connection cleanup
  }
}

/**
 * Deletes a stale connection and all associated records.
 */
async function cleanupStaleConnection(
  connectionId: string,
  kind: string | undefined,
  stats: CleanupStats
): Promise<void> {
  try {
    // Clean up robot presence if this was a robot connection
    if (kind !== 'monitor') {
      await cleanupRobotPresence(connectionId);
      stats.cleanedRobotPresence++;
    }

    // Clean up sessions
    await cleanupConnectionSessions(connectionId);
    stats.cleanedSessions++;

    // Delete the connection record
    await db.send(
      new DeleteItemCommand({
        TableName: CONN_TABLE,
        Key: {
          connectionId: { S: connectionId },
        },
      })
    );

    stats.cleanedConnections++;
    console.log(`[CLEANUP] Successfully cleaned up stale connection ${connectionId} (kind: ${kind || 'unknown'})`);
  } catch (error) {
    stats.errors++;
    console.error(`[CLEANUP] Failed to cleanup connection ${connectionId}:`, error);
    throw error;
  }
}

/**
 * Main cleanup handler - runs on schedule to clean up stale connections.
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
    // Calculate threshold timestamp (1 hour ago)
    const thresholdTimestamp = Date.now() - STALE_CONNECTION_THRESHOLD_MS;

    // Scan connections with filter for stale ones (older than threshold)
    // Note: FilterExpression is applied after scan, but reduces processing
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;
    
    do {
      const scanResult: ScanCommandOutput = await db.send(
        new ScanCommand({
          TableName: CONN_TABLE,
          ExclusiveStartKey: lastEvaluatedKey,
          FilterExpression: 'ts < :threshold', // Only scan items older than threshold
          ExpressionAttributeValues: {
            ':threshold': { N: String(thresholdTimestamp) },
          },
          // Limit to 100 items per scan to avoid timeout
          Limit: 100,
        })
      );

      const items = scanResult.Items || [];
      stats.totalConnections += items.length;

      // Process each stale connection
      for (const item of items) {
        const connectionId = item.connectionId?.S;
        const timestamp = item.ts?.N ? parseInt(item.ts.N, 10) : null;
        const kind = item.kind?.S;

        if (!connectionId) {
          console.warn('[CLEANUP] Connection item missing connectionId:', item);
          continue;
        }

        // Connection is already filtered to be stale (older than threshold)
        if (timestamp && timestamp < thresholdTimestamp) {
          stats.staleConnections++;

          // Check if connection is actually dead
          const isAlive = await isConnectionAlive(connectionId);

          if (!isAlive) {
            // Connection is dead - clean it up
            await cleanupStaleConnection(connectionId, kind, stats);
          } else {
            // Connection is alive but old - update timestamp to prevent future checks
            // (This handles edge cases where connection is still active but timestamp is old)
            console.log(`[CLEANUP] Connection ${connectionId} is stale but still alive - skipping cleanup`);
          }
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const duration = Date.now() - startTime;
    console.log('[CLEANUP] Cleanup job completed', {
      duration: `${duration}ms`,
      ...stats,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cleanup job completed',
        stats,
        duration: `${duration}ms`,
      }),
    };
  } catch (error) {
    stats.errors++;
    console.error('[CLEANUP] Cleanup job failed:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Cleanup job failed',
        message: error instanceof Error ? error.message : String(error),
        stats,
      }),
    };
  }
};

