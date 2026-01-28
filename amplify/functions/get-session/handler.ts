import type { AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";

const db = new DynamoDBClient({});
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME!;

interface GetSessionArgs {
  sessionId?: string;
}

interface SessionResult {
  id: string;
  userId: string;
  userEmail: string | null;
  robotId: string;
  robotName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  status: string | null;
}

export const handler = async (
  event: AppSyncResolverEvent<GetSessionArgs>
): Promise<SessionResult | null> => {
  const { sessionId } = event.arguments;
  const identity = event.identity as { sub?: string; username?: string } | undefined;
  const sub = identity?.sub ?? null;
  const username = identity?.username ?? null;
  const userId = sub ?? username;

  if (!userId) {
    console.error('[GET_SESSION] No user identity');
    return null;
  }

  try {
    if (sessionId) {
      const result = await db.send(new QueryCommand({
        TableName: SESSION_TABLE_NAME,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':id': { S: sessionId },
        },
        Limit: 1,
      }));

      const session = result.Items?.[0];
      if (!session) return null;

      const owner = session.owner?.S ?? '';
      const sessionUserId = session.userId?.S ?? '';
      const isOwner = owner === sub || owner === username;
      const isUser = sessionUserId === sub || sessionUserId === username;

      if (!isOwner && !isUser) {
        console.warn('[GET_SESSION] User not authorized to view session');
        return null;
      }

      return {
        id: session.id?.S || '',
        userId: session.userId?.S || '',
        userEmail: session.userEmail?.S || null,
        robotId: session.robotId?.S || '',
        robotName: session.robotName?.S || null,
        startedAt: session.startedAt?.S || '',
        endedAt: session.endedAt?.S || null,
        durationSeconds: session.durationSeconds?.N ? parseInt(session.durationSeconds.N) : null,
        status: session.status?.S || null,
      };
    }

    const result = await db.send(new QueryCommand({
      TableName: SESSION_TABLE_NAME,
      IndexName: 'userIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': { S: sub ?? userId },
      },
      ScanIndexForward: false,
      Limit: 1,
    }));

    const session = result.Items?.[0];
    if (!session) return null;

    return {
      id: session.id?.S || '',
      userId: session.userId?.S || '',
      userEmail: session.userEmail?.S || null,
      robotId: session.robotId?.S || '',
      robotName: session.robotName?.S || null,
      startedAt: session.startedAt?.S || '',
      endedAt: session.endedAt?.S || null,
      durationSeconds: session.durationSeconds?.N ? parseInt(session.durationSeconds.N) : null,
      status: session.status?.S || null,
    };
  } catch (err) {
    console.error('[GET_SESSION_ERROR]', err);
    return null;
  }
};

