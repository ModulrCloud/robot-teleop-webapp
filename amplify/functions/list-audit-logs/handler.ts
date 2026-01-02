import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["listAuditLogsLambda"]["functionHandler"] = async (event) => {
  console.log("List Audit Logs request:", JSON.stringify(event, null, 2));

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  // Get user email for domain-based access check
  // In GraphQL Lambda resolvers, email is typically not in identity directly
  // Always fetch from Cognito using the username to ensure we have the email
  let userEmail: string | undefined;
  
  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    console.log("Fetched email from Cognito:", userEmail, "for username:", identity.username);
  } catch (error) {
    console.error("Could not fetch email from Cognito:", error);
    // If we can't get the email, we can't verify domain access, so deny
    throw new Error("Unauthorized: could not verify user email");
  }
  
  if (!userEmail) {
    console.error("No email found for user:", identity.username);
    throw new Error("Unauthorized: user email not found");
  }
  
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  
  // Check if user is a Modulr employee (@modulr.cloud domain)
  const isModulrEmployee = userEmail && 
    typeof userEmail === 'string' && 
    userEmail.toLowerCase().trim().endsWith('@modulr.cloud');
  
  console.log("Access check:", {
    username: identity.username,
    userEmail,
    userEmailType: typeof userEmail,
    userEmailLower: userEmail ? userEmail.toLowerCase().trim() : null,
    endsWithModulr: userEmail ? userEmail.toLowerCase().trim().endsWith('@modulr.cloud') : false,
    adminGroups,
    isInAdminGroup,
    isModulrEmployee,
  });
  
  // SECURITY: Only admins (ADMINS group) or Modulr employees can view audit logs
  if (!isInAdminGroup && !isModulrEmployee) {
    console.error("Access denied:", {
      username: identity.username,
      userEmail,
      isInAdminGroup,
      isModulrEmployee,
    });
    throw new Error("Unauthorized: only ADMINS or Modulr employees (@modulr.cloud) can view audit logs");
  }

  const { limit = 10, paginationToken, adminUserId, targetUserId } = event.arguments || {};

  // Helper function to parse pagination token (handles both base64 and plain JSON)
  const parsePaginationToken = (token: string | undefined | null): any => {
    if (!token) return undefined;
    try {
      // Try base64 decode first (for Scan operations)
      try {
        const decoded = Buffer.from(token, 'base64').toString();
        return JSON.parse(decoded);
      } catch {
        // If base64 decode fails, try parsing as plain JSON (for Query operations)
        return typeof token === 'string' ? JSON.parse(token) : token;
      }
    } catch {
      // If all parsing fails, return undefined
      return undefined;
    }
  };

  // Helper function to encode pagination token consistently (always base64)
  const encodePaginationToken = (key: any): string | undefined => {
    if (!key) return undefined;
    return Buffer.from(JSON.stringify(key)).toString('base64');
  };

  try {
    let auditLogs: any[] = [];
    let nextToken: string | undefined = undefined;
    const limitValue = limit ?? undefined; // Convert null to undefined

    // If filtering by adminUserId or targetUserId, use Query; otherwise Scan
    if (adminUserId) {
      const queryResult = await docClient.send(
        new QueryCommand({
          TableName: ADMIN_AUDIT_TABLE,
          IndexName: 'adminUserIdIndex',
          KeyConditionExpression: 'adminUserId = :adminUserId',
          ExpressionAttributeValues: {
            ':adminUserId': adminUserId,
          },
          Limit: limitValue,
          ExclusiveStartKey: parsePaginationToken(paginationToken),
          ScanIndexForward: false, // Most recent first
        })
      );
      auditLogs = queryResult.Items || [];
      nextToken = encodePaginationToken(queryResult.LastEvaluatedKey);
    } else if (targetUserId) {
      const queryResult = await docClient.send(
        new QueryCommand({
          TableName: ADMIN_AUDIT_TABLE,
          IndexName: 'targetUserIdIndex',
          KeyConditionExpression: 'targetUserId = :targetUserId',
          ExpressionAttributeValues: {
            ':targetUserId': targetUserId,
          },
          Limit: limitValue,
          ExclusiveStartKey: parsePaginationToken(paginationToken),
          ScanIndexForward: false, // Most recent first
        })
      );
      auditLogs = queryResult.Items || [];
      nextToken = encodePaginationToken(queryResult.LastEvaluatedKey);
    } else {
      // Use GSI with logType="AUDIT" as partition key and timestamp as sort key
      // This allows efficient Query instead of expensive Scan
      // Query only reads the items we need (10-50 per page) instead of scanning entire table
      
      try {
        const queryParams: any = {
          TableName: ADMIN_AUDIT_TABLE,
          IndexName: 'timestampIndexV2', // New GSI with logType + timestamp
          KeyConditionExpression: 'logType = :logType',
          ExpressionAttributeValues: {
            ':logType': 'AUDIT',
          },
          Limit: limitValue || 10,
          ScanIndexForward: false, // Most recent first (descending by timestamp)
        };

        // Handle pagination token
        if (paginationToken) {
          const parsedToken = parsePaginationToken(paginationToken);
          if (parsedToken?.lastEvaluatedKey) {
            queryParams.ExclusiveStartKey = parsedToken.lastEvaluatedKey;
          }
        }

        const queryResult = await docClient.send(new QueryCommand(queryParams));
        auditLogs = queryResult.Items || [];
        
        // If GSI query returns 0 results, fall back to Scan to find old records without logType
        // This handles the migration period where old records don't have logType field
        if (auditLogs.length === 0 && !paginationToken) {
          console.log("GSI query returned 0 results, falling back to Scan to find old records without logType");
          throw new Error("FALLBACK_TO_SCAN"); // Trigger fallback
        }
        
        nextToken = encodePaginationToken({ lastEvaluatedKey: queryResult.LastEvaluatedKey });
        console.log(`Query returned ${auditLogs.length} items using efficient GSI query`);
      } catch (queryError: any) {
        // Fallback to Scan if:
        // 1. GSI doesn't exist yet (during migration)
        // 2. Query returned 0 results (old records without logType field)
        if (queryError.name === 'ResourceNotFoundException' || 
            queryError.message?.includes('index') || 
            queryError.message?.includes('GSI') ||
            queryError.message === 'FALLBACK_TO_SCAN') {
          console.warn("Falling back to Scan (GSI not found or no results with logType):", queryError.message);
          
          // Limit scan to prevent excessive reads
          const MAX_SCAN_ITEMS = 5000; // Keep last 5000 records
          let allItems: any[] = [];
          let lastKey: any = undefined;
          let scanCount = 0;
          const maxScans = 50; // Safety limit
          
          do {
            const scanResult = await docClient.send(
              new ScanCommand({
                TableName: ADMIN_AUDIT_TABLE,
                Limit: 100,
                ExclusiveStartKey: lastKey,
              })
            );
            
            if (scanResult.Items) {
              allItems = allItems.concat(scanResult.Items);
            }
            
            lastKey = scanResult.LastEvaluatedKey;
            scanCount++;
            
            if (allItems.length >= MAX_SCAN_ITEMS || !lastKey || scanCount >= maxScans) {
              break;
            }
          } while (lastKey);
          
          // Sort by timestamp (most recent first)
          allItems.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
          });
          
          // Paginate
          const pageSize = limitValue || 10;
          let pageNumber = 0;
          
          if (paginationToken) {
            try {
              const decoded = Buffer.from(paginationToken, 'base64').toString();
              const parsed = JSON.parse(decoded);
              pageNumber = parsed.pageNumber || 0;
            } catch (e) {
              pageNumber = 0;
            }
          }
          
          const startIndex = pageNumber * pageSize;
          const endIndex = startIndex + pageSize;
          auditLogs = allItems.slice(startIndex, endIndex);
          
          if (endIndex < allItems.length) {
            nextToken = encodePaginationToken({ pageNumber: pageNumber + 1, totalItems: allItems.length });
          } else {
            nextToken = undefined;
          }
          
          console.log(`Fallback Scan returned ${auditLogs.length} items from ${allItems.length} total`);
        } else {
          // Re-throw if it's a different error
          throw queryError;
        }
      }
    }

    // Fetch emails for adminUserId and targetUserId
    
    const enrichedLogs = await Promise.all(
      auditLogs.map(async (log) => {
        const enriched: any = { ...log };
        
        // Fetch admin email
        if (log.adminUserId) {
          try {
            const adminResponse = await cognito.send(
              new AdminGetUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: log.adminUserId,
              })
            );
            enriched.adminEmail = adminResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value || log.adminUserId;
          } catch (error) {
            console.warn(`Could not fetch email for admin ${log.adminUserId}:`, error);
            enriched.adminEmail = log.adminUserId;
          }
        }
        
        // Fetch target user email
        if (log.targetUserId) {
          try {
            const targetResponse = await cognito.send(
              new AdminGetUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: log.targetUserId,
              })
            );
            enriched.targetEmail = targetResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value || log.targetUserId;
          } catch (error) {
            console.warn(`Could not fetch email for target ${log.targetUserId}:`, error);
            enriched.targetEmail = log.targetUserId;
          }
        }
        
        return enriched;
      })
    );

    return JSON.stringify({
      success: true,
      auditLogs: enrichedLogs,
      count: enrichedLogs.length,
      nextToken: nextToken || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error listing audit logs:", error);
    throw new Error(`Failed to list audit logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

