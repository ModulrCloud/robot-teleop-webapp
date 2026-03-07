import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const CERTIFICATION_REQUEST_TABLE = process.env.CERTIFICATION_REQUEST_TABLE!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["listCertificationRequestsLambda"]["functionHandler"] = async (event) => {
  const { status, partnerId, robotId, limit = 50, nextToken } = event.arguments ?? {};
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }
  const username = identity.username as string;
  const groups = (identity as { groups?: string[] }).groups ?? [];
  const isAdmin = groups.some((g: string) => g === "ADMINS" || g === "ADMIN");

  let items: Record<string, unknown>[] = [];
  let nextTokenOut: string | undefined;

  if (isAdmin) {
    if (status) {
      const q = await docClient.send(
        new QueryCommand({
          TableName: CERTIFICATION_REQUEST_TABLE,
          IndexName: "statusIndex",
          KeyConditionExpression: "#status = :status",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": status },
          Limit: limit ?? 50,
          ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, "base64").toString()) : undefined,
        })
      );
      items = (q.Items ?? []) as Record<string, unknown>[];
      nextTokenOut = q.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(q.LastEvaluatedKey)).toString("base64")
        : undefined;
    } else if (partnerId) {
      const q = await docClient.send(
        new QueryCommand({
          TableName: CERTIFICATION_REQUEST_TABLE,
          IndexName: "partnerIdIndex",
          KeyConditionExpression: "partnerId = :pid",
          ExpressionAttributeValues: { ":pid": partnerId },
          Limit: limit ?? 50,
          ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, "base64").toString()) : undefined,
        })
      );
      items = (q.Items ?? []) as Record<string, unknown>[];
      nextTokenOut = q.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(q.LastEvaluatedKey)).toString("base64")
        : undefined;
    } else if (robotId) {
      const q = await docClient.send(
        new QueryCommand({
          TableName: CERTIFICATION_REQUEST_TABLE,
          IndexName: "robotIdIndex",
          KeyConditionExpression: "robotId = :rid",
          ExpressionAttributeValues: { ":rid": robotId },
          Limit: limit ?? 50,
          ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, "base64").toString()) : undefined,
        })
      );
      items = (q.Items ?? []) as Record<string, unknown>[];
      nextTokenOut = q.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(q.LastEvaluatedKey)).toString("base64")
        : undefined;
    } else {
      const scan = await docClient.send(
        new ScanCommand({
          TableName: CERTIFICATION_REQUEST_TABLE,
          Limit: limit ?? 50,
          ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, "base64").toString()) : undefined,
        })
      );
      items = (scan.Items ?? []) as Record<string, unknown>[];
      nextTokenOut = scan.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(scan.LastEvaluatedKey)).toString("base64")
        : undefined;
    }
  } else {
    const q = await docClient.send(
      new QueryCommand({
        TableName: CERTIFICATION_REQUEST_TABLE,
        IndexName: "partnerIdIndex",
        KeyConditionExpression: "partnerId = :pid",
        ExpressionAttributeValues: { ":pid": username },
        Limit: limit ?? 50,
        ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, "base64").toString()) : undefined,
      })
    );
    items = (q.Items ?? []) as Record<string, unknown>[];
    nextTokenOut = q.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(q.LastEvaluatedKey)).toString("base64")
      : undefined;
  }

  const requests: Record<string, unknown>[] = [];
  for (const r of items) {
    let robotName: string | undefined;
    if (r.robotUuid) {
      try {
        const robotGet = await docClient.send(
          new GetCommand({
            TableName: ROBOT_TABLE_NAME,
            Key: { id: r.robotUuid },
          })
        );
        robotName = robotGet.Item?.name as string | undefined;
      } catch {
        // ignore
      }
    }
    let partnerEmail: string | undefined;
    if (USER_POOL_ID && r.partnerUserId) {
      try {
        const userResp = await cognito.send(
          new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: String(r.partnerUserId),
          })
        );
        partnerEmail = userResp.UserAttributes?.find((a) => a.Name === "email")?.Value;
      } catch {
        // ignore
      }
    }
    requests.push({
      id: r.id,
      robotId: r.robotId,
      robotUuid: r.robotUuid,
      partnerId: r.partnerId,
      partnerUserId: r.partnerUserId,
      partnerEmail,
      status: r.status,
      requestedAt: r.requestedAt,
      paidAt: r.paidAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      rejectionReason: r.rejectionReason,
      amountCredits: r.amountCredits,
      robotName: robotName ?? undefined,
    });
  }

  return JSON.stringify({
    requests,
    nextToken: nextTokenOut ?? null,
  });
};
