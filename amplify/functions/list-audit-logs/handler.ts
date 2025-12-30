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
      // For Scan without filters, DynamoDB doesn't maintain global sort order
      // We need to fetch all items, sort them globally, then paginate in memory
      // This is a workaround until we can use a proper GSI with timestamp as sort key
      
      // Fetch all audit logs (with reasonable limit to avoid performance issues)
      // We fetch all items and sort globally, then paginate in memory
      // This ensures proper global sort order across all pages
      const MAX_SCAN_ITEMS = 1000; // Limit to prevent excessive reads
      let allItems: any[] = [];
      let lastKey: any = undefined;
      let scanCount = 0;
      const maxScans = 10; // Safety limit
      
      // Always fetch all items (ignore pagination token for scanning)
      // The token will be used for page number after sorting
      do {
        const scanResult = await docClient.send(
          new ScanCommand({
            TableName: ADMIN_AUDIT_TABLE,
            Limit: 100, // Scan in batches of 100
            ExclusiveStartKey: lastKey,
          })
        );
        
        if (scanResult.Items) {
          allItems = allItems.concat(scanResult.Items);
        }
        
        lastKey = scanResult.LastEvaluatedKey;
        scanCount++;
        
        // Stop if we've reached our limit or no more items
        if (allItems.length >= MAX_SCAN_ITEMS || !lastKey || scanCount >= maxScans) {
          break;
        }
      } while (lastKey);
      
      // Sort all items globally by timestamp (most recent first)
      allItems.sort((a, b) => {
        const timeA = new Date(a.timestamp || 0).getTime();
        const timeB = new Date(b.timestamp || 0).getTime();
        return timeB - timeA;
      });
      
      // Calculate pagination - use page number from token
      const pageSize = limitValue || 10;
      let pageNumber = 0;
      
      if (paginationToken) {
        try {
          const decoded = Buffer.from(paginationToken, 'base64').toString();
          const parsed = JSON.parse(decoded);
          pageNumber = parsed.pageNumber || 0;
        } catch (e) {
          console.warn("Failed to parse pagination token, starting from page 0:", e);
          pageNumber = 0;
        }
      }
      
      const startIndex = pageNumber * pageSize;
      const endIndex = startIndex + pageSize;
      
      // Get the page of items
      auditLogs = allItems.slice(startIndex, endIndex);
      
      // Set next token if there are more items
      if (endIndex < allItems.length) {
        nextToken = encodePaginationToken({ pageNumber: pageNumber + 1, totalItems: allItems.length });
      } else {
        nextToken = undefined;
      }
      
      console.log(`Fetched ${allItems.length} total items, returning page ${pageNumber} (items ${startIndex}-${Math.min(endIndex - 1, allItems.length - 1)})`);
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

