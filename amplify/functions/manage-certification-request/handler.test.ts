import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "aws-lambda";

const { mockSend, mockCognitoSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockCognitoSend: vi.fn(),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: class GetCommand {},
  UpdateCommand: class UpdateCommand {},
}));

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = mockCognitoSend;
  },
  AdminGetUserCommand: class AdminGetUserCommand {},
}));

import { handler } from "./handler";

const CERTIFICATION_REQUEST_TABLE = "CertificationRequestTable";
const ROBOT_TABLE = "RobotTable";
const USER_POOL_ID = "us-east-1_xxx";

const REQUEST_ID = "req-123";
const ROBOT_UUID = "robot-uuid-456";
const ADMIN_USERNAME = "admin-user";

function makeEvent(overrides: {
  certificationRequestId?: string;
  action?: string;
  rejectionReason?: string;
  username?: string;
  groups?: string[];
} = {}) {
  return {
    arguments: {
      certificationRequestId: REQUEST_ID,
      action: "approve",
      ...overrides,
    },
    identity: {
      username: ADMIN_USERNAME,
      groups: ["ADMINS" as string],
      ...overrides,
    },
  } as unknown as Parameters<typeof handler>[0];
}

const noOpContext = {} as Context;
const noOpCallback = (): void => {};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CERTIFICATION_REQUEST_TABLE = CERTIFICATION_REQUEST_TABLE;
  process.env.ROBOT_TABLE_NAME = ROBOT_TABLE;
  process.env.USER_POOL_ID = USER_POOL_ID;
  mockCognitoSend.mockResolvedValue({
    UserAttributes: [{ Name: "email", Value: "admin@modulr.cloud" }],
  });
});

describe("manageCertificationRequestLambda handler", () => {
  it("throws when certificationRequestId or action is missing", async () => {
    await expect(
      handler(
        makeEvent({ certificationRequestId: undefined, action: undefined }),
        noOpContext,
        noOpCallback
      )
    ).rejects.toThrow("certificationRequestId and action are required");

    await expect(
      handler(makeEvent({ action: "invalid" }), noOpContext, noOpCallback)
    ).rejects.toThrow("action must be 'approve' or 'reject'");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns error when certification request not found", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toBe("Certification request not found");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns error when request status is not paid/pending_review", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        id: REQUEST_ID,
        status: "requested",
        robotUuid: ROBOT_UUID,
        robotId: "robot-abc",
      },
    });

    const result = await handler(makeEvent({ action: "approve" }), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toContain("cannot be approved");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("approve: updates request to approved and robot to Ctrlr Approved", async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          id: REQUEST_ID,
          status: "paid",
          robotUuid: ROBOT_UUID,
          robotId: "robot-abc",
        },
      })
      .mockResolvedValueOnce(undefined) // UpdateCommand CertificationRequest
      .mockResolvedValueOnce(undefined); // UpdateCommand Robot

    const result = await handler(makeEvent({ action: "approve" }), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.action).toBe("approved");
    expect(body.robotId).toBe("robot-abc");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("reject: updates request to rejected with reason", async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          id: REQUEST_ID,
          status: "paid",
          robotUuid: ROBOT_UUID,
          robotId: "robot-abc",
        },
      })
      .mockResolvedValueOnce(undefined); // UpdateCommand CertificationRequest only (no Robot update)

    const result = await handler(
      makeEvent({ action: "reject", rejectionReason: "Does not meet quality bar" }),
      noOpContext,
      noOpCallback
    );
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.action).toBe("rejected");
    expect(body.rejectionReason).toBe("Does not meet quality bar");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
