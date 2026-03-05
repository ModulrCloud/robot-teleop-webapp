import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_TERMS_ACCEPTANCE_TABLE = process.env.USER_TERMS_ACCEPTANCE_TABLE!;

export const handler: Schema["acceptTermsLambda"]["functionHandler"] = async (event) => {
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }

  const userId = identity.username as string;
  const { termsVersion } = event.arguments;
  if (!termsVersion || typeof termsVersion !== "string") {
    throw new Error("Missing required: termsVersion");
  }

  const acceptedTermsAt = new Date().toISOString();

  const existing = await docClient.send(
    new QueryCommand({
      TableName: USER_TERMS_ACCEPTANCE_TABLE,
      IndexName: "userIdIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      Limit: 1,
    })
  );

  const item = existing.Items?.[0];
  const id = item?.id ?? randomUUID();

  await docClient.send(
    new PutCommand({
      TableName: USER_TERMS_ACCEPTANCE_TABLE,
      Item: {
        id,
        userId,
        acceptedTermsVersion: termsVersion,
        acceptedTermsAt,
      },
    })
  );

  return JSON.stringify({
    success: true,
    acceptedTermsVersion: termsVersion,
    acceptedTermsAt,
  });
};
