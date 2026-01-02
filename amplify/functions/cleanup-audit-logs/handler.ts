import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;
const MAX_RECORDS_TO_KEEP = 5000; // Keep last 5000 audit log records

/**
 * Cleanup Lambda that runs on schedule to keep only the last N audit log records.
 * Deletes older records beyond the retention limit.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  console.log('[CLEANUP_AUDIT_LOGS] Starting audit log cleanup job');
  const startTime = Date.now();

  const stats = {
    totalRecords: 0,
    recordsToKeep: 0,
    recordsDeleted: 0,
    errors: 0,
  };

  try {
    // Query all audit logs using the GSI, sorted by timestamp (newest first)
    let allRecords: any[] = [];
    let lastEvaluatedKey: any = undefined;

    do {
      const queryParams: any = {
        TableName: ADMIN_AUDIT_TABLE,
        IndexName: 'timestampIndexV2',
        KeyConditionExpression: 'logType = :logType',
        ExpressionAttributeValues: {
          ':logType': 'AUDIT',
        },
        ScanIndexForward: false, // Most recent first
      };

      if (lastEvaluatedKey) {
        queryParams.ExclusiveStartKey = lastEvaluatedKey;
      }

      const queryResult = await docClient.send(new QueryCommand(queryParams));
      
      if (queryResult.Items) {
        allRecords = allRecords.concat(queryResult.Items);
      }

      lastEvaluatedKey = queryResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    stats.totalRecords = allRecords.length;
    stats.recordsToKeep = Math.min(allRecords.length, MAX_RECORDS_TO_KEEP);

    console.log(`[CLEANUP_AUDIT_LOGS] Found ${stats.totalRecords} total records, keeping ${stats.recordsToKeep}`);

    // If we have more records than the limit, delete the oldest ones
    if (allRecords.length > MAX_RECORDS_TO_KEEP) {
      const recordsToDelete = allRecords.slice(MAX_RECORDS_TO_KEEP);
      console.log(`[CLEANUP_AUDIT_LOGS] Deleting ${recordsToDelete.length} old records`);

      // Delete records in batches (DynamoDB allows up to 25 items per batch, but we'll do one at a time for simplicity)
      for (const record of recordsToDelete) {
        try {
          await docClient.send(
            new DeleteCommand({
              TableName: ADMIN_AUDIT_TABLE,
              Key: {
                id: record.id,
              },
            })
          );
          stats.recordsDeleted++;
        } catch (error) {
          console.error(`[CLEANUP_AUDIT_LOGS] Failed to delete record ${record.id}:`, error);
          stats.errors++;
        }
      }
    } else {
      console.log(`[CLEANUP_AUDIT_LOGS] No cleanup needed - record count (${allRecords.length}) is within limit (${MAX_RECORDS_TO_KEEP})`);
    }

    const duration = Date.now() - startTime;
    const result = {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Audit log cleanup completed',
        stats,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      }),
    };

    console.log('[CLEANUP_AUDIT_LOGS] Cleanup job completed', result.body);
    return result;
  } catch (error) {
    console.error('[CLEANUP_AUDIT_LOGS] Cleanup job failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

