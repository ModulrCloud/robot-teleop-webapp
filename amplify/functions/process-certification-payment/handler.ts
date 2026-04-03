import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CERTIFICATION_REQUEST_TABLE = process.env.CERTIFICATION_REQUEST_TABLE!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const PLATFORM_REVENUE_ENTRY_TABLE = process.env.PLATFORM_REVENUE_ENTRY_TABLE!;

export const handler: Schema["processCertificationPaymentLambda"]["functionHandler"] = async (event) => {
  const { certificationRequestId } = event.arguments ?? {};
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }
  const username = identity.username as string;
  if (!certificationRequestId) {
    throw new Error("certificationRequestId is required");
  }

  const getRequest = await docClient.send(
    new GetCommand({
      TableName: CERTIFICATION_REQUEST_TABLE,
      Key: { id: certificationRequestId },
    })
  );
  const request = getRequest.Item;
  if (!request) {
    return JSON.stringify({
      success: false,
      error: "Certification request not found",
    });
  }
  if (String(request.status) !== "requested") {
    return JSON.stringify({
      success: false,
      error: `Request is not in 'requested' state (current: ${request.status}). Payment may already be complete.`,
    });
  }
  if (request.partnerUserId !== username) {
    return JSON.stringify({
      success: false,
      error: "Only the request owner can pay for certification",
    });
  }

  const feeCredits = Number(request.amountCredits) || 0;
  if (feeCredits <= 0) {
    return JSON.stringify({
      success: false,
      error: "Invalid certification fee",
    });
  }

  // Get partner's credit balance
  const creditsQuery = await docClient.send(
    new QueryCommand({
      TableName: USER_CREDITS_TABLE,
      IndexName: "userIdIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": username },
      Limit: 1,
    })
  );
  const creditsRecord = creditsQuery.Items?.[0];
  const currentCredits = creditsRecord?.credits ?? 0;
  if (currentCredits < feeCredits) {
    return JSON.stringify({
      success: false,
      error: "Insufficient credits",
      currentCredits,
      requiredCredits: feeCredits,
    });
  }
  if (!creditsRecord?.id) {
    return JSON.stringify({
      success: false,
      error: "User credits record not found",
    });
  }

  const newCredits = currentCredits - feeCredits;
  const now = new Date().toISOString();
  const transactionId = randomUUID();
  const entryId = randomUUID();

  // Atomic transaction: deduct credits, record transaction, mark request paid, write revenue.
  // Either all succeed or none do; conditions prevent double-spend and double-apply.
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: USER_CREDITS_TABLE,
            Key: { id: creditsRecord.id },
            UpdateExpression: "SET credits = :credits, lastUpdated = :now",
            ConditionExpression: "credits >= :fee",
            ExpressionAttributeValues: {
              ":credits": newCredits,
              ":now": now,
              ":fee": feeCredits,
            },
          },
        },
        {
          Put: {
            TableName: CREDIT_TRANSACTIONS_TABLE,
            Item: {
              id: transactionId,
              userId: username,
              amount: -feeCredits,
              transactionType: "certification_fee",
              description: `Ctrlr certification fee for request ${certificationRequestId}`,
              createdAt: now,
            },
          },
        },
        {
          Update: {
            TableName: CERTIFICATION_REQUEST_TABLE,
            Key: { id: certificationRequestId },
            UpdateExpression: "SET #status = :status, paidAt = :paidAt",
            ConditionExpression: "#status = :requested",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": "paid",
              ":paidAt": now,
              ":requested": "requested",
            },
          },
        },
        {
          Put: {
            TableName: PLATFORM_REVENUE_ENTRY_TABLE,
            Item: {
              id: entryId,
              createdAt: now,
              transactionType: "certification_fee",
              amountCredits: feeCredits,
              referenceId: certificationRequestId,
              description: `Certification fee for request ${certificationRequestId}`,
            },
          },
        },
      ],
    })
  );

  return JSON.stringify({
    success: true,
    certificationRequestId,
    status: "paid",
    amountCredits: feeCredits,
    newBalance: newCredits,
  });
};
