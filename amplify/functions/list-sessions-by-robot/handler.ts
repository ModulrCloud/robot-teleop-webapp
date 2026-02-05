import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const PARTNER_TABLE_NAME = process.env.PARTNER_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

/** Mask client email so the client (browser) never receives full PII. Returns e.g. "ab***@domain.com" or "Client". */
function maskClientEmail(email: string | null | undefined): string {
  if (!email) return "Client";
  const at = email.indexOf("@");
  if (at <= 0) return "Client";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local}***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

export const handler: Schema["listSessionsByRobotLambda"]["functionHandler"] = async (event) => {
  const { robotId, limit = 20, nextToken } = event.arguments;
  const identity = event.identity;

  console.log("[listSessionsByRobot] request", {
    robotId: event.arguments?.robotId,
    limit: event.arguments?.limit,
    hasIdentity: !!identity,
    requesterUsername: identity && "username" in identity ? identity.username : undefined,
  });

  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized: must be logged in with Cognito" }),
    };
  }

  if (!robotId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "robotId is required" }),
    };
  }

  const requesterId = identity.username;
  let isAdmin = false;

  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: requesterId,
      })
    );
    const groups = userResponse.UserAttributes?.find((attr) => attr.Name === "cognito:groups")?.Value;
    isAdmin = groups?.includes("ADMINS") ?? false;
  } catch (error) {
    console.warn("Could not fetch user info:", error);
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Unauthorized: could not verify user" }),
    };
  }

  // If not admin, verify requester is the robot owner (partner)
  if (!isAdmin && ROBOT_TABLE_NAME && PARTNER_TABLE_NAME) {
    try {
      const robotResult = await docClient.send(
        new QueryCommand({
          TableName: ROBOT_TABLE_NAME,
          IndexName: "robotIdIndex",
          KeyConditionExpression: "robotId = :robotId",
          ExpressionAttributeValues: { ":robotId": robotId },
          Limit: 1,
        })
      );
      const robot = robotResult.Items?.[0];
      if (!robot?.partnerId) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: "Robot not found or has no owner" }),
        };
      }
      const partnerResult = await docClient.send(
        new GetCommand({
          TableName: PARTNER_TABLE_NAME,
          Key: { id: robot.partnerId },
        })
      );
      const partnerCognitoUsername = partnerResult.Item?.cognitoUsername;
      if (partnerCognitoUsername !== requesterId) {
        console.log("[listSessionsByRobot] 403: caller is not robot owner", {
          requesterId,
          partnerCognitoUsername,
        });
        return {
          statusCode: 403,
          body: JSON.stringify({ error: "Unauthorized: only the robot owner or an admin can view connection history" }),
        };
      }
    } catch (err) {
      console.error("Error verifying robot ownership:", err);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to verify access" }),
      };
    }
  }

  const pageSize = limit ?? 20;
  const maxFetch = 100;

  try {
    // Decode nextToken: either DynamoDB LastEvaluatedKey (for robotIdStartedAtIndex) or { page: number } for robotIdIndex paging
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let pageToken: number | undefined;
    if (nextToken) {
      try {
        const decoded = JSON.parse(Buffer.from(nextToken, "base64").toString());
        if (typeof decoded?.page === "number") {
          pageToken = decoded.page;
        } else {
          lastEvaluatedKey = decoded as Record<string, unknown>;
        }
      } catch (e) {
        console.warn("Invalid nextToken:", e);
      }
    }

    let queryResult: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
    let usedRobotIdIndex = false;

    // Prefer robotIdIndex first so connection history shows even if robotIdStartedAtIndex is missing or empty
    const robotIdIndexResult = await docClient.send(
      new QueryCommand({
        TableName: SESSION_TABLE_NAME,
        IndexName: "robotIdIndex",
        KeyConditionExpression: "robotId = :robotId",
        ExpressionAttributeValues: { ":robotId": robotId },
        Limit: maxFetch,
      })
    );
    const robotIdIndexItems = robotIdIndexResult.Items || [];
    console.log("[listSessionsByRobot] robotIdIndex", { robotId, itemCount: robotIdIndexItems.length });

    if (robotIdIndexItems.length > 0) {
      usedRobotIdIndex = true;
      const sorted = [...robotIdIndexItems].sort((a, b) => {
        const tA = a.startedAt ? new Date(String(a.startedAt)).getTime() : 0;
        const tB = b.startedAt ? new Date(String(b.startedAt)).getTime() : 0;
        return tB - tA;
      });
      const page = pageToken ?? 0;
      const start = page * pageSize;
      const pageItems = sorted.slice(start, start + pageSize);
      const hasMore = start + pageItems.length < sorted.length;
      queryResult = {
        Items: pageItems,
        LastEvaluatedKey: hasMore ? undefined : undefined,
      };
      // Encode next page as token when using robotIdIndex paging
      if (hasMore) {
        (queryResult as { nextPageToken?: string }).nextPageToken = Buffer.from(
          JSON.stringify({ page: page + 1 })
        ).toString("base64");
      }
    } else {
      // No items from robotIdIndex; try robotIdStartedAtIndex, then Scan as last resort (finds items even if GSI key differs)
      try {
        queryResult = await docClient.send(
          new QueryCommand({
            TableName: SESSION_TABLE_NAME,
            IndexName: "robotIdStartedAtIndex",
            KeyConditionExpression: "robotId = :robotId",
            ExpressionAttributeValues: { ":robotId": robotId },
            Limit: pageSize,
            ScanIndexForward: false,
            ExclusiveStartKey: lastEvaluatedKey,
          })
        );
      } catch (indexErr: unknown) {
        const err = indexErr as { name?: string; code?: string };
        console.warn("[listSessionsByRobot] robotIdStartedAtIndex error", err?.name ?? err?.code);
        queryResult = { Items: [] };
      }
      const gsiItems = queryResult.Items || [];
      if (gsiItems.length === 0) {
        // Scan table with FilterExpression so we find sessions by robotId even if GSI uses different key attributes
        const scanResult = await docClient.send(
          new ScanCommand({
            TableName: SESSION_TABLE_NAME,
            FilterExpression: "robotId = :robotId",
            ExpressionAttributeValues: { ":robotId": robotId },
            Limit: maxFetch,
          })
        );
        const scanItems = scanResult.Items || [];
        console.log("[listSessionsByRobot] Scan fallback", { robotId, itemCount: scanItems.length });
        if (scanItems.length > 0) {
          const sorted = [...scanItems].sort((a, b) => {
            const tA = a.startedAt ? new Date(String(a.startedAt)).getTime() : 0;
            const tB = b.startedAt ? new Date(String(b.startedAt)).getTime() : 0;
            return tB - tA;
          });
          const page = pageToken ?? 0;
          const start = page * pageSize;
          queryResult = {
            Items: sorted.slice(start, start + pageSize),
            LastEvaluatedKey: undefined,
          };
          const hasMore = start + (queryResult.Items?.length ?? 0) < sorted.length;
          if (hasMore) {
            (queryResult as { nextPageToken?: string }).nextPageToken = Buffer.from(
              JSON.stringify({ page: page + 1 })
            ).toString("base64");
          }
        }
      }
    }

    // Do not send userEmail to the client; send clientDisplay (masked) only. userId kept for future
    // TODO: Partner report/ban abusive client (reverse ACL) — allow partner to report or ban a client
    // from using their robots; will need to map userId to an actionable identity for platform admins.
    const sessions = (queryResult.Items || []).map((s: Record<string, unknown>) => {
      const email = (s.userEmail as string) ?? null;
      return {
        id: s.id,
        userId: s.userId,
        clientDisplay: maskClientEmail(email),
        robotId: s.robotId,
        robotName: s.robotName ?? null,
        startedAt: s.startedAt,
        endedAt: s.endedAt ?? null,
        durationSeconds: s.durationSeconds ?? null,
        status: s.status ?? null,
        creditsCharged: s.creditsCharged ?? null,
        partnerEarnings: s.partnerEarnings ?? null,
        createdAt: s.createdAt,
      };
    });

    let nextTokenOut: string | undefined;
    const withPageToken = queryResult as { nextPageToken?: string };
    if (withPageToken.nextPageToken) {
      nextTokenOut = withPageToken.nextPageToken;
    } else if (queryResult.LastEvaluatedKey) {
      nextTokenOut = Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString("base64");
    }

    console.log("[listSessionsByRobot] success", { robotId, count: sessions.length, usedRobotIdIndex });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        sessions,
        nextToken: nextTokenOut ?? null,
      }),
    };
  } catch (error) {
    console.error("Error listing sessions by robot:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to list sessions",
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
