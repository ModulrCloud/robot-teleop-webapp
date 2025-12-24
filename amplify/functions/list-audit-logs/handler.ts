import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ADMIN_AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE!;

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
    const { CognitoIdentityProviderClient, AdminGetUserCommand } = await import('@aws-sdk/client-cognito-identity-provider');
    const cognitoClient = new CognitoIdentityProviderClient({});
    const USER_POOL_ID = process.env.USER_POOL_ID!;
    const userResponse = await cognitoClient.send(
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

  const { limit = 100, adminUserId, targetUserId } = event.arguments || {};

  try {
    let auditLogs: any[] = [];
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
          ScanIndexForward: false, // Most recent first
        })
      );
      auditLogs = queryResult.Items || [];
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
          ScanIndexForward: false, // Most recent first
        })
      );
      auditLogs = queryResult.Items || [];
    } else {
      // Scan all audit logs, sorted by timestamp (most recent first)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: ADMIN_AUDIT_TABLE,
          Limit: limitValue,
        })
      );
      auditLogs = scanResult.Items || [];
      
      // Sort by timestamp descending (most recent first)
      auditLogs.sort((a, b) => {
        const timeA = new Date(a.timestamp || 0).getTime();
        const timeB = new Date(b.timestamp || 0).getTime();
        return timeB - timeA;
      });
    }

    return JSON.stringify({
      success: true,
      auditLogs,
      count: auditLogs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error listing audit logs:", error);
    throw new Error(`Failed to list audit logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

