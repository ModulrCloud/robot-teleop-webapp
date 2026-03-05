import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE!;
const USER_TERMS_ACCEPTANCE_TABLE = process.env.USER_TERMS_ACCEPTANCE_TABLE!;

const DEFAULT_TERMS_VERSION = "1.0";

export const handler: Schema["getTermsStatusLambda"]["functionHandler"] = async (event) => {
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }

  const userId = identity.username as string;

  let currentVersion = DEFAULT_TERMS_VERSION;
  let currentLastUpdatedAt = new Date().toISOString().slice(0, 10);

  try {
    const [versionResult, updatedResult] = await Promise.all([
      docClient.send(
        new QueryCommand({
          TableName: PLATFORM_SETTINGS_TABLE,
          IndexName: "settingKeyIndex",
          KeyConditionExpression: "settingKey = :key",
          ExpressionAttributeValues: { ":key": "termsVersion" },
          Limit: 1,
        })
      ),
      docClient.send(
        new QueryCommand({
          TableName: PLATFORM_SETTINGS_TABLE,
          IndexName: "settingKeyIndex",
          KeyConditionExpression: "settingKey = :key",
          ExpressionAttributeValues: { ":key": "termsLastUpdatedAt" },
          Limit: 1,
        })
      ),
    ]);
    if (versionResult.Items?.[0]?.settingValue) {
      currentVersion = versionResult.Items[0].settingValue as string;
    }
    if (updatedResult.Items?.[0]?.settingValue) {
      currentLastUpdatedAt = updatedResult.Items[0].settingValue as string;
    }
  } catch (e) {
    console.warn("Could not read terms version from PlatformSettings, using defaults:", e);
  }

  let acceptedVersion: string | null = null;
  let acceptedAt: string | null = null;

  try {
    const accResult = await docClient.send(
      new QueryCommand({
        TableName: USER_TERMS_ACCEPTANCE_TABLE,
        IndexName: "userIdIndex",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
        Limit: 1,
      })
    );
    const acc = accResult.Items?.[0];
    if (acc?.acceptedTermsVersion && acc?.acceptedTermsAt) {
      acceptedVersion = acc.acceptedTermsVersion as string;
      acceptedAt = acc.acceptedTermsAt as string;
    }
  } catch (e) {
    console.warn("Could not read user terms acceptance:", e);
  }

  const mustAccept = acceptedVersion !== currentVersion;

  return JSON.stringify({
    success: true,
    currentVersion,
    currentLastUpdatedAt,
    acceptedVersion,
    acceptedAt,
    mustAccept,
  });
};
