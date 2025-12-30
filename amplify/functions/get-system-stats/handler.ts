import type { Schema } from "../../data/resource";
import { CognitoIdentityProviderClient, ListUsersCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_POOL_ID = process.env.USER_POOL_ID!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const PARTNER_PAYOUT_TABLE = process.env.PARTNER_PAYOUT_TABLE!;

export const handler: Schema["getSystemStatsLambda"]["functionHandler"] = async (event) => {
  console.log("Get System Stats request:", JSON.stringify(event, null, 2));

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
  
  // SECURITY: Only admins (ADMINS group) or Modulr employees can view system stats
  if (!isInAdminGroup && !isModulrEmployee) {
    console.error("Access denied:", {
      username: identity.username,
      userEmail,
      isInAdminGroup,
      isModulrEmployee,
    });
    throw new Error("Unauthorized: only ADMINS or Modulr employees (@modulr.cloud) can view system stats");
  }

  try {
    // Get total users count by paginating through all users in Cognito
    let totalUsers = 0;
    try {
      let paginationToken: string | undefined = undefined;
      let hasMore = true;
      
      do {
        const usersList: { Users?: any[]; PaginationToken?: string } = await cognito.send(new ListUsersCommand({
          UserPoolId: USER_POOL_ID,
          Limit: 60, // Maximum allowed by Cognito
          PaginationToken: paginationToken,
        }));
        
        // Count users in this batch
        if (usersList.Users) {
          totalUsers += usersList.Users.length;
        }
        
        // Check if there are more users to fetch
        paginationToken = usersList.PaginationToken;
        hasMore = !!paginationToken;
      } while (hasMore);
      
      console.log(`✅ Total users counted: ${totalUsers}`);
    } catch (error) {
      console.warn("Could not get user count:", error);
      totalUsers = 0;
    }

    // Get total robots count
    let totalRobots = 0;
    let activeRobots = 0;
    try {
      console.log("Scanning Robot table:", ROBOT_TABLE_NAME);
      const robotsScan = await docClient.send(
        new ScanCommand({
          TableName: ROBOT_TABLE_NAME,
          Select: 'COUNT',
        })
      );
      totalRobots = robotsScan.Count || 0;
      console.log("Total robots found:", totalRobots);
      
      // Count active robots (would need robot status check - simplified for now)
      // For now, we'll just use total robots
      activeRobots = totalRobots;
    } catch (error) {
      console.error("Error getting robot count:", error);
      console.error("Robot table name:", ROBOT_TABLE_NAME);
      // Set to 0 instead of leaving undefined
      totalRobots = 0;
      activeRobots = 0;
    }

    // Get total revenue (sum of all credit transactions where type is 'purchase')
    let totalRevenue = 0;
    try {
      const transactionsScan = await docClient.send(
        new ScanCommand({
          TableName: CREDIT_TRANSACTIONS_TABLE,
          FilterExpression: '#type = :purchase',
          ExpressionAttributeNames: {
            '#type': 'type',
          },
          ExpressionAttributeValues: {
            ':purchase': 'purchase',
          },
        })
      );
      
      totalRevenue = (transactionsScan.Items || []).reduce((sum, item) => {
        return sum + (item.pricePaid || 0);
      }, 0);
    } catch (error) {
      console.warn("Could not calculate revenue from transactions:", error);
    }

    // Add platform fees from PartnerPayout table (this is the platform's actual earnings)
    try {
      const payoutsScan = await docClient.send(
        new ScanCommand({
          TableName: PARTNER_PAYOUT_TABLE,
        })
      );
      
      const platformFees = (payoutsScan.Items || []).reduce((sum, item) => {
        return sum + (item.platformFee || 0);
      }, 0);
      
      // Convert credits to dollars and add to revenue
      totalRevenue += platformFees / 100;
      console.log(`✅ Added platform fees: $${(platformFees / 100).toFixed(2)}`);
    } catch (error) {
      console.warn("Could not calculate platform fees from payouts:", error);
    }

    // Get active sessions count
    let activeSessions = 0;
    try {
      const sessionsScan = await docClient.send(
        new ScanCommand({
          TableName: SESSION_TABLE_NAME,
          FilterExpression: '#status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':active': 'active',
          },
          Select: 'COUNT',
        })
      );
      activeSessions = sessionsScan.Count || 0;
    } catch (error) {
      console.warn("Could not get active sessions count:", error);
    }

    // Get total credits in system
    let totalCredits = 0;
    try {
      const creditsScan = await docClient.send(
        new ScanCommand({
          TableName: USER_CREDITS_TABLE,
        })
      );
      
      totalCredits = (creditsScan.Items || []).reduce((sum, item) => {
        return sum + (item.credits || 0);
      }, 0);
    } catch (error) {
      console.warn("Could not calculate total credits:", error);
    }

    const stats = {
      totalUsers,
      totalRobots,
      activeRobots,
      totalRevenue: Math.round(totalRevenue * 100) / 100, // Round to 2 decimal places
      activeSessions,
      totalCredits,
    };

    console.log("📊 Final stats object:", JSON.stringify(stats, null, 2));
    console.log("📊 Total robots value:", totalRobots, "Type:", typeof totalRobots);

    const response = {
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    };

    console.log("📤 Returning response:", JSON.stringify(response, null, 2));

    return JSON.stringify(response);
  } catch (error) {
    console.error("Error getting system stats:", error);
    throw new Error(`Failed to get system stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

