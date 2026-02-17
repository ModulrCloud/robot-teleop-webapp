import type { Schema } from "../../data/resource";
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const CONN_TABLE = process.env.CONN_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Cap returned entries for admin diagnostics to keep payload size bounded
const ROBOT_PRESENCE_DISPLAY_CAP = 20;
const CONN_TABLE_DISPLAY_CAP = 10;

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

    // Fetch robot presence entries (for admin debugging) and count
    const presenceResult = await db.send(
      new ScanCommand({
        TableName: ROBOT_PRESENCE_TABLE,
        ProjectionExpression: 'robotId, connectionId, #status, updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
      })
    );

    const rawItems = presenceResult.Items || [];
    console.log('[ACTIVE_ROBOTS_DEBUG] Raw presence Items count:', rawItems.length);
    if (rawItems.length > 0) {
      console.log('[ACTIVE_ROBOTS_DEBUG] First raw item keys:', Object.keys(rawItems[0]));
      console.log('[ACTIVE_ROBOTS_DEBUG] First raw item sample:', JSON.stringify({
        robotId: rawItems[0].robotId,
        connectionId: rawItems[0].connectionId,
        status: rawItems[0].status,
        updatedAt: rawItems[0].updatedAt,
      }));
    }

    const presenceItems = rawItems.map((item) => ({
      robotId: item.robotId?.S ?? '',
      connectionId: item.connectionId?.S ?? '',
      status: item.status?.S ?? '',
      updatedAt: item.updatedAt?.N ? parseInt(item.updatedAt.N, 10) : null,
    }));
    const activeRobotsCount = presenceItems.length;
    console.log('[ACTIVE_ROBOTS_DEBUG] presenceItems count:', presenceItems.length, 'sample:', JSON.stringify(presenceItems.slice(0, 2)));

    // Fetch CONN_TABLE entries (for admin debugging) and count
    const connScanResult = await db.send(
      new ScanCommand({
        TableName: CONN_TABLE,
        ProjectionExpression: 'connectionId, #kind, ts',
        ExpressionAttributeNames: { '#kind': 'kind' },
      })
    );

    const connItems = (connScanResult.Items || []).map((item) => ({
      connectionId: item.connectionId?.S ?? '',
      kind: item.kind?.S ?? '',
      ts: item.ts?.N ? parseInt(item.ts.N, 10) : null,
    }));
    const totalConnections = connItems.length;

    let robotConnections = 0;
    let clientConnections = 0;
    let monitorConnections = 0;
    for (const item of connItems) {
      const kind = item.kind;
      if (kind === 'monitor') {
        monitorConnections++;
      } else if (kind === 'client') {
        clientConnections++;
      } else {
        robotConnections++;
      }
    }

    const response = {
      success: true,
      activeRobots: activeRobotsCount,
      totalConnections,
      robotConnections,
      clientConnections,
      monitorConnections,
      robotPresenceEntries: presenceItems.slice(0, ROBOT_PRESENCE_DISPLAY_CAP),
      connTableEntries: connItems.slice(0, CONN_TABLE_DISPLAY_CAP),
    };
    console.log('[ACTIVE_ROBOTS_DEBUG] Returning response keys:', Object.keys(response), 'robotPresenceEntries:', response.robotPresenceEntries.length, 'connTableEntries:', response.connTableEntries.length);
    return JSON.stringify(response);
  } catch (error) {
    console.error('[ACTIVE_ROBOTS] Failed to fetch active robots:', error);
    throw new Error(`Failed to fetch active robots: ${error instanceof Error ? error.message : String(error)}`);
  }
};

