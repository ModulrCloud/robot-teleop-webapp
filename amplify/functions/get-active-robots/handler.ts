import type { Schema } from "../../data/resource";
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const CONN_TABLE = process.env.CONN_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const db = new DynamoDBClient({});
const cognito = new CognitoIdentityProviderClient({});

export const handler: Schema["getActiveRobotsLambda"]["functionHandler"] = async (event) => {
  console.log("Get Active Robots request:", JSON.stringify(event, null, 2));

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  // Get user email for domain-based access check
  let userEmail: string | undefined;
  
  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
  } catch (error) {
    console.error("Could not fetch email from Cognito:", error);
    throw new Error("Unauthorized: could not verify user email");
  }
  
  if (!userEmail) {
    throw new Error("Unauthorized: user email not found");
  }

  // Check if user is admin (ADMINS group or @modulr.cloud email)
  const adminGroups = "groups" in identity ? identity.groups : [];
  const isInAdminGroup = adminGroups?.includes("ADMINS") || adminGroups?.includes("ADMIN");
  const isModulrEmployee = userEmail && 
    typeof userEmail === 'string' && 
    userEmail.toLowerCase().trim().endsWith('@modulr.cloud');
  
  // SECURITY: Only admins or Modulr employees can view active robots
  if (!isInAdminGroup && !isModulrEmployee) {
    throw new Error("Unauthorized: only ADMINS or Modulr employees (@modulr.cloud) can view active robots");
  }

  try {
    console.log('[ACTIVE_ROBOTS] Fetching active robots count');

    // Count robots in RobotPresenceTable (these are online robots)
    const presenceResult = await db.send(
      new ScanCommand({
        TableName: ROBOT_PRESENCE_TABLE,
        Select: 'COUNT', // Only count, don't return items
      })
    );

    const activeRobotsCount = presenceResult.Count || 0;

    // Also count total connections (for reference)
    const connResult = await db.send(
      new ScanCommand({
        TableName: CONN_TABLE,
        Select: 'COUNT',
      })
    );

    const totalConnections = connResult.Count || 0;

    // Count robot connections (kind !== 'monitor')
    let robotConnections = 0;
    let clientConnections = 0;
    let monitorConnections = 0;

    const connScanResult = await db.send(
      new ScanCommand({
        TableName: CONN_TABLE,
        ProjectionExpression: 'kind',
      })
    );

    for (const item of connScanResult.Items || []) {
      const kind = item.kind?.S;
      if (kind === 'monitor') {
        monitorConnections++;
      } else if (kind === 'client') {
        clientConnections++;
      } else {
        robotConnections++;
      }
    }

    return JSON.stringify({
      activeRobots: activeRobotsCount,
      totalConnections,
      robotConnections,
      clientConnections,
      monitorConnections,
    });
  } catch (error) {
    console.error('[ACTIVE_ROBOTS] Failed to fetch active robots:', error);
    throw new Error(`Failed to fetch active robots: ${error instanceof Error ? error.message : String(error)}`);
  }
};

