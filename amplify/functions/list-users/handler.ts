import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, ListUsersCommand, AdminGetUserCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const PARTNER_TABLE_NAME = process.env.PARTNER_TABLE_NAME!;
const CLIENT_TABLE_NAME = process.env.CLIENT_TABLE_NAME!;

export const handler: Schema["listUsersLambda"]["functionHandler"] = async (event) => {
  console.log("=== LIST USERS LAMBDA START ===");
  console.log("Full event:", JSON.stringify(event, null, 2));
  console.log("Identity object:", JSON.stringify(event.identity, null, 2));

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    console.error("❌ No identity or username in identity");
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  console.log("✅ Username found:", identity.username);
  console.log("USER_POOL_ID:", USER_POOL_ID);

  // Get user email for domain-based access check
  // Always fetch from Cognito using the username to ensure we have the email
  // (Same pattern as getSystemStatsLambda which works)
  let userEmail: string | undefined;
  
  try {
    console.log("🔍 Fetching user from Cognito using username:", identity.username);
    console.log("🔍 USER_POOL_ID:", USER_POOL_ID);
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    console.log("✅ Cognito response received");
    console.log("UserAttributes:", JSON.stringify(userResponse.UserAttributes, null, 2));
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    console.log("📧 Fetched email from Cognito:", userEmail, "for username:", identity.username);
  } catch (error: any) {
    console.error("❌ Could not fetch email from Cognito:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));
    console.error("Error name:", error?.name, "Error code:", error?.code);
    console.error("Error message:", error?.message);
    // If we can't get the email, we can't verify domain access, so deny
    throw new Error("Unauthorized: could not verify user email");
  }
  
  if (!userEmail) {
    console.error("❌ No email found for user:", identity.username);
    throw new Error("Unauthorized: user email not found");
  }
  
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  
  // Check if user is a Modulr employee (@modulr.cloud domain)
  const emailLower = userEmail.toLowerCase().trim();
  const endsWithModulr = emailLower.endsWith('@modulr.cloud');
  const isModulrEmployee = userEmail && 
    typeof userEmail === 'string' && 
    endsWithModulr;
  
  console.log("🔐 Access check:", {
    username: identity.username,
    userEmail,
    userEmailType: typeof userEmail,
    userEmailLower: emailLower,
    endsWithModulr,
    adminGroups: JSON.stringify(adminGroups),
    isInAdminGroup,
    isModulrEmployee,
  });
  
  // SECURITY: Only admins (ADMINS group) or Modulr employees can list users
  if (!isInAdminGroup && !isModulrEmployee) {
    console.error("❌ ACCESS DENIED:", {
      username: identity.username,
      userEmail,
      userEmailLower: emailLower,
      endsWithModulr,
      isInAdminGroup,
      isModulrEmployee,
    });
    throw new Error("Unauthorized: only ADMINS or Modulr employees (@modulr.cloud) can list users");
  }
  
  console.log("✅ ACCESS GRANTED");

  const { limit = 50, paginationToken } = event.arguments || {};

  try {
    // List users from Cognito with pagination
    const listUsersParams: any = {
      UserPoolId: USER_POOL_ID,
      Limit: Math.min(limit || 50, 60), // Cognito max is 60
    };

    if (paginationToken) {
      listUsersParams.PaginationToken = paginationToken;
    }

    const cognitoUsers = await cognito.send(new ListUsersCommand(listUsersParams));

    // Get list of admin usernames (for classification)
    let adminUsernames: Set<string> = new Set();
    try {
      const adminGroupResponse = await cognito.send(
        new ListUsersInGroupCommand({
          UserPoolId: USER_POOL_ID,
          GroupName: 'ADMINS',
        })
      );
      adminUsernames = new Set(
        (adminGroupResponse.Users || []).map(u => u.Username || '').filter(Boolean)
      );
    } catch (error) {
      console.warn("Failed to get admin users list:", error);
    }

    // Get all Partner and Client records for classification lookup
    let partnerUsernames: Set<string> = new Set();
    let clientUsernames: Set<string> = new Set();
    
    try {
      if (PARTNER_TABLE_NAME) {
        const partnersResult = await docClient.send(
          new ScanCommand({
            TableName: PARTNER_TABLE_NAME,
            ProjectionExpression: 'cognitoUsername',
          })
        );
        partnerUsernames = new Set(
          (partnersResult.Items || [])
            .map(item => item.cognitoUsername)
            .filter(Boolean)
        );
      }
    } catch (error) {
      console.warn("Failed to get partner usernames:", error);
    }

    try {
      if (CLIENT_TABLE_NAME) {
        const clientsResult = await docClient.send(
          new ScanCommand({
            TableName: CLIENT_TABLE_NAME,
            ProjectionExpression: 'cognitoUsername',
          })
        );
        clientUsernames = new Set(
          (clientsResult.Items || [])
            .map(item => item.cognitoUsername)
            .filter(Boolean)
        );
      }
    } catch (error) {
      console.warn("Failed to get client usernames:", error);
    }

    // Get credit balances and classification for all users
    const usersWithCredits = await Promise.all(
      (cognitoUsers.Users || []).map(async (cognitoUser) => {
        const username = cognitoUser.Username || '';
        const email = cognitoUser.Attributes?.find(attr => attr.Name === 'email')?.Value || '';
        const name = cognitoUser.Attributes?.find(attr => attr.Name === 'name')?.Value || '';
        
        // Determine user classification
        let classification = 'CLIENT'; // Default
        if (adminUsernames.has(username)) {
          classification = 'ADMIN';
        } else if (partnerUsernames.has(username)) {
          classification = 'PARTNER';
        } else if (clientUsernames.has(username)) {
          classification = 'CLIENT';
        }
        
        // Get credit balance from DynamoDB
        let credits = 0;
        try {
          const creditsResult = await docClient.send(
            new QueryCommand({
              TableName: USER_CREDITS_TABLE,
              IndexName: 'userIdIndex',
              KeyConditionExpression: 'userId = :userId',
              ExpressionAttributeValues: {
                ':userId': username,
              },
              Limit: 1,
            })
          );
          
          if (creditsResult.Items && creditsResult.Items.length > 0) {
            credits = creditsResult.Items[0].credits || 0;
          }
        } catch (error) {
          console.warn(`Failed to get credits for user ${username}:`, error);
          // Continue with 0 credits if lookup fails
        }

        return {
          username,
          email,
          name: name || email?.split('@')[0] || username,
          credits,
          classification, // CLIENT, PARTNER, or ADMIN
          status: cognitoUser.UserStatus,
          enabled: cognitoUser.Enabled,
          createdAt: cognitoUser.UserCreateDate?.toISOString(),
          lastModified: cognitoUser.UserLastModifiedDate?.toISOString(),
          groups: cognitoUser.Attributes?.find(attr => attr.Name === 'custom:groups')?.Value || '',
        };
      })
    );

    // Return pagination token if there are more users
    const nextToken = cognitoUsers.PaginationToken || null;

    return JSON.stringify({
      success: true,
      users: usersWithCredits,
      count: usersWithCredits.length,
      nextToken,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error listing users:", error);
    throw new Error(`Failed to list users: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

