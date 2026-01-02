import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE;

export interface AuditLogEntry {
  action: string; // e.g., 'ASSIGN_ADMIN', 'REMOVE_ADMIN', 'ADJUST_CREDITS', etc.
  adminUserId: string; // Who performed the action
  targetUserId?: string; // Who was affected (optional)
  reason?: string; // Optional reason for the action
  metadata?: Record<string, any>; // Additional metadata
}

/**
 * Creates an audit log entry in the AdminAuditTable
 * @param docClient - DynamoDB Document Client
 * @param entry - Audit log entry data
 * @returns Promise that resolves when the audit log is created
 */
export async function createAuditLog(
  docClient: DynamoDBDocumentClient,
  entry: AuditLogEntry
): Promise<void> {
  console.log("=== CREATE_AUDIT_LOG FUNCTION START ===");
  console.log(`Action: ${entry.action}`);
  console.log(`AdminUserId: ${entry.adminUserId}`);
  console.log(`ADMIN_AUDIT_TABLE env var: ${ADMIN_AUDIT_TABLE ? `SET (${ADMIN_AUDIT_TABLE})` : 'NOT SET'}`);
  console.log(`Full entry object:`, JSON.stringify(entry, null, 2));
  
  if (!ADMIN_AUDIT_TABLE) {
    console.error("❌❌❌ ADMIN_AUDIT_TABLE NOT CONFIGURED - AUDIT LOG WILL NOT BE CREATED ❌❌❌");
    console.error("Available env vars containing 'AUDIT' or 'TABLE':", 
      Object.keys(process.env).filter(k => k.includes('AUDIT') || k.includes('TABLE')));
    console.error("All env vars:", Object.keys(process.env).sort());
    return;
  }

  try {
    // Build audit item - only include targetUserId if it's actually provided
    // DynamoDB GSIs cannot index NULL values, so we must omit the field entirely
    const auditItem: any = {
      id: randomUUID(),
      action: entry.action,
      adminUserId: entry.adminUserId,
      reason: entry.reason || null,
      timestamp: new Date().toISOString(),
      logType: 'AUDIT', // For GSI timestampIndexV2 (partition key)
      metadata: entry.metadata || {},
    };
    
    // Only include targetUserId if it's provided (not null/undefined)
    // This prevents GSI index errors when targetUserId is null
    if (entry.targetUserId) {
      auditItem.targetUserId = entry.targetUserId;
    }
    
    console.log("=== CREATING AUDIT LOG ITEM ===");
    console.log("Table Name:", ADMIN_AUDIT_TABLE);
    console.log("Audit Item:", JSON.stringify(auditItem, null, 2));
    
    const putCommand = new PutCommand({
      TableName: ADMIN_AUDIT_TABLE,
      Item: auditItem,
    });
    
    console.log("Sending PutCommand to DynamoDB...");
    const result = await docClient.send(putCommand);
    console.log("PutCommand result:", JSON.stringify(result, null, 2));
    
    console.log(`✅✅✅ SUCCESSFULLY CREATED AUDIT LOG: ${entry.action} by ${entry.adminUserId} ✅✅✅`);
    console.log("=== CREATE_AUDIT_LOG FUNCTION END (SUCCESS) ===");
  } catch (error) {
    // Log the error with full details for debugging
    console.error("❌❌❌ FAILED TO CREATE AUDIT LOG ENTRY ❌❌❌");
    console.error("Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    console.error("Full error object:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error("Action:", entry.action);
    console.error("AdminUserId:", entry.adminUserId);
    console.error("TableName:", ADMIN_AUDIT_TABLE);
    console.error("=== CREATE_AUDIT_LOG FUNCTION END (ERROR) ===");
    
    // Re-throw the error so callers can catch it and handle it appropriately
    // Callers should catch and not re-throw if they don't want to break the main operation
    throw error;
  }
}

