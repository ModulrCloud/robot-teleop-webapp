import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const PLATFORM_REVENUE_ENTRY_TABLE = process.env.PLATFORM_REVENUE_ENTRY_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["listPlatformRevenueEntriesLambda"]["functionHandler"] = async (event) => {
  const { transactionType, startDate, endDate, limit = 100, nextToken } = event.arguments ?? {};
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }
  const username = identity.username as string;
  const groups = (identity as { groups?: string[] }).groups ?? [];
  const isAdmin = groups.some((g: string) => g === "ADMINS" || g === "ADMIN");
  let isModulrEmployee = false;
  if (USER_POOL_ID) {
    try {
      const userResp = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        })
      );
      const email = userResp.UserAttributes?.find((a) => a.Name === "email")?.Value;
      isModulrEmployee = !!email && String(email).toLowerCase().endsWith("@modulr.cloud");
    } catch {
      // ignore
    }
  }
  if (!isAdmin && !isModulrEmployee) {
    throw new Error("Only admins or Modulr employees can list platform revenue entries");
  }

  const scanResult = await docClient.send(
    new ScanCommand({
      TableName: PLATFORM_REVENUE_ENTRY_TABLE,
      Limit: Math.min(limit ?? 100, 500),
      ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, "base64").toString()) : undefined,
    })
  );
  let items = (scanResult.Items ?? []) as Record<string, unknown>[];

  if (transactionType) {
    items = items.filter((i) => i.transactionType === transactionType);
  }
  if (startDate) {
    items = items.filter((i) => String(i.createdAt ?? "").localeCompare(startDate) >= 0);
  }
  if (endDate) {
    items = items.filter((i) => String(i.createdAt ?? "").localeCompare(endDate) <= 0);
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const entries = items.slice(0, limit ?? 100).map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    transactionType: e.transactionType,
    amountCredits: e.amountCredits,
    referenceId: e.referenceId,
    description: e.description,
  }));

  const nextTokenOut = scanResult.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(scanResult.LastEvaluatedKey)).toString("base64")
    : null;

  return JSON.stringify({
    entries,
    nextToken: nextTokenOut,
  });
};
