import type { Schema } from "../../data/resource";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const CERTIFICATION_REQUEST_TABLE = process.env.CERTIFICATION_REQUEST_TABLE!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["manageCertificationRequestLambda"]["functionHandler"] = async (event) => {
  const { certificationRequestId, action, rejectionReason } = event.arguments ?? {};
  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in");
  }
  const username = identity.username as string;
  if (!certificationRequestId || !action) {
    throw new Error("certificationRequestId and action are required");
  }
  if (action !== "approve" && action !== "reject") {
    throw new Error("action must be 'approve' or 'reject'");
  }

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
    throw new Error("Only admins or Modulr employees can approve or reject certification requests");
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
  const status = String(request.status);
  if (status !== "paid" && status !== "pending_review") {
    return JSON.stringify({
      success: false,
      error: `Request cannot be ${action}d (current status: ${status})`,
    });
  }

  const now = new Date().toISOString();
  const robotUuid = request.robotUuid;
  const robotId = request.robotId;

  if (action === "approve") {
    await docClient.send(
      new UpdateCommand({
        TableName: CERTIFICATION_REQUEST_TABLE,
        Key: { id: certificationRequestId },
        UpdateExpression: "SET #status = :status, reviewedAt = :reviewedAt, reviewedBy = :reviewedBy",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "approved",
          ":reviewedAt": now,
          ":reviewedBy": username,
        },
      })
    );
    if (robotUuid) {
      await docClient.send(
        new UpdateCommand({
          TableName: ROBOT_TABLE_NAME,
          Key: { id: robotUuid },
          UpdateExpression: "SET modulrApproved = :approved, modulrApprovedAt = :now, isVerified = :verified",
          ExpressionAttributeValues: {
            ":approved": true,
            ":now": now,
            ":verified": true,
          },
        })
      );
    }
    return JSON.stringify({
      success: true,
      certificationRequestId,
      action: "approved",
      robotId,
    });
  }

  await docClient.send(
    new UpdateCommand({
      TableName: CERTIFICATION_REQUEST_TABLE,
      Key: { id: certificationRequestId },
      UpdateExpression:
        "SET #status = :status, reviewedAt = :reviewedAt, reviewedBy = :reviewedBy, rejectionReason = :reason",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "rejected",
        ":reviewedAt": now,
        ":reviewedBy": username,
        ":reason": rejectionReason ?? "",
      },
    })
  );
  return JSON.stringify({
    success: true,
    certificationRequestId,
    action: "rejected",
    rejectionReason: rejectionReason ?? undefined,
  });
};
