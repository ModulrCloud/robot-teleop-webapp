import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const PARTNER_TABLE_NAME = process.env.PARTNER_TABLE_NAME!;
const CERTIFICATION_REQUEST_TABLE = process.env.CERTIFICATION_REQUEST_TABLE!;
const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE!;

const DEFAULT_CERTIFICATION_FEE_CREDITS = 1000;

export const handler: Schema["createCertificationRequestLambda"]["functionHandler"] = async (event) => {
  const { robotId } = event.arguments ?? {};
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }
  const username = identity.username as string;
  if (!robotId) {
    throw new Error("robotId is required");
  }

  // Get robot
  const robotQuery = await docClient.send(
    new QueryCommand({
      TableName: ROBOT_TABLE_NAME,
      IndexName: "robotIdIndex",
      KeyConditionExpression: "robotId = :robotId",
      ExpressionAttributeValues: { ":robotId": robotId },
      Limit: 1,
    })
  );
  const robot = robotQuery.Items?.[0];
  if (!robot) {
    return JSON.stringify({
      success: false,
      error: "Robot not found",
    });
  }

  // Robot must not already be certified
  if (robot.modulrApproved === true) {
    return JSON.stringify({
      success: false,
      error: "Robot is already Modulr Approved",
    });
  }

  // Get partner to verify ownership
  const partnerId = robot.partnerId;
  if (!partnerId) {
    return JSON.stringify({
      success: false,
      error: "Robot has no owner",
    });
  }
  const partnerGet = await docClient.send(
    new GetCommand({
      TableName: PARTNER_TABLE_NAME,
      Key: { id: partnerId },
    })
  );
  const partner = partnerGet.Item;
  const partnerCognitoUsername = partner?.cognitoUsername;
  if (!partnerCognitoUsername || partnerCognitoUsername !== username) {
    return JSON.stringify({
      success: false,
      error: "Only the robot owner can request certification",
    });
  }

  // Check for existing open request (requested, paid, pending_review)
  const existingByRobot = await docClient.send(
    new QueryCommand({
      TableName: CERTIFICATION_REQUEST_TABLE,
      IndexName: "robotIdIndex",
      KeyConditionExpression: "robotId = :robotId",
      ExpressionAttributeValues: { ":robotId": robotId },
      Limit: 10,
    })
  );
  const openStatuses = ["requested", "paid", "pending_review"];
  const hasOpen = (existingByRobot.Items ?? []).some((r) =>
    openStatuses.includes(String(r.status ?? ""))
  );
  if (hasOpen) {
    return JSON.stringify({
      success: false,
      error: "A certification request is already open for this robot",
    });
  }

  // Get fee from platform settings
  let feeCredits = DEFAULT_CERTIFICATION_FEE_CREDITS;
  try {
    const settingsResult = await docClient.send(
      new QueryCommand({
        TableName: PLATFORM_SETTINGS_TABLE,
        IndexName: "settingKeyIndex",
        KeyConditionExpression: "settingKey = :key",
        ExpressionAttributeValues: { ":key": "modulrCertificationFeeCredits" },
        Limit: 1,
      })
    );
    const val = settingsResult.Items?.[0]?.settingValue;
    if (val != null) {
      const parsed = parseInt(String(val), 10);
      if (!Number.isNaN(parsed) && parsed >= 0) feeCredits = parsed;
    }
  } catch (e) {
    console.warn("Could not read modulrCertificationFeeCredits, using default:", e);
  }

  const requestId = randomUUID();
  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: CERTIFICATION_REQUEST_TABLE,
      Item: {
        id: requestId,
        robotId,
        robotUuid: robot.id,
        partnerId: partnerCognitoUsername,
        partnerUserId: partnerCognitoUsername,
        owner: partnerCognitoUsername,
        status: "requested",
        requestedAt: now,
        amountCredits: feeCredits,
      },
    })
  );

  return JSON.stringify({
    success: true,
    certificationRequestId: requestId,
    status: "requested",
    amountCredits: feeCredits,
  });
};
