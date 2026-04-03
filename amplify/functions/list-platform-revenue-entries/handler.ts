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
    throw new Error("Only admins or Ctrl + R employees can list platform revenue entries");
  }

  const hasFilters = !!(transactionType || startDate || endDate);
  const maxLimit = Math.min(limit ?? 100, 500);
  let items: Record<string, unknown>[] = [];
  let scanLastKey: Record<string, unknown> | undefined;

  if (hasFilters) {
    // When filtering by type or date, scan the full table so entries (e.g. certification_fee)
    // are not missed — DynamoDB Scan returns items in arbitrary order, so a single limited
    // scan can omit rows that match the filter.
    let lastKey: Record<string, unknown> | undefined;
    do {
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: PLATFORM_REVENUE_ENTRY_TABLE,
          Limit: 1000,
          ExclusiveStartKey: lastKey,
        })
      );
      items = items.concat((scanResult.Items ?? []) as Record<string, unknown>[]);
      lastKey = (scanResult.LastEvaluatedKey ?? undefined) as Record<string, unknown> | undefined;
    } while (lastKey);
  } else {
    const startKey = nextToken
      ? (JSON.parse(Buffer.from(nextToken, "base64").toString()) as Record<string, unknown>)
      : undefined;
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: PLATFORM_REVENUE_ENTRY_TABLE,
        Limit: maxLimit,
        ExclusiveStartKey: startKey,
      })
    );
    items = (scanResult.Items ?? []) as Record<string, unknown>[];
    scanLastKey = (scanResult.LastEvaluatedKey ?? undefined) as Record<string, unknown> | undefined;
  }

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

  let offset = 0;
  if (hasFilters && nextToken) {
    try {
      const decoded = JSON.parse(Buffer.from(nextToken, "base64").toString()) as { offset?: number };
      offset = Math.max(0, Number(decoded?.offset) || 0);
    } catch {
      // ignore invalid token
    }
  }
  const slice = items.slice(offset, offset + maxLimit);
  const entries = slice.map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    transactionType: e.transactionType,
    amountCredits: e.amountCredits,
    referenceId: e.referenceId,
    description: e.description,
  }));

  const hasMore = offset + slice.length < items.length;
  const nextTokenOut = hasFilters
    ? hasMore
      ? Buffer.from(JSON.stringify({ offset: offset + maxLimit })).toString("base64")
      : null
    : scanLastKey
      ? Buffer.from(JSON.stringify(scanLastKey)).toString("base64")
      : null;

  return JSON.stringify({
    entries,
    nextToken: nextTokenOut,
  });
};
