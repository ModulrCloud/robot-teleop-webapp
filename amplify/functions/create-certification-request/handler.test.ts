import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "aws-lambda";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: class GetCommand {},
  QueryCommand: class QueryCommand {},
  PutCommand: class PutCommand {},
}));

import { handler } from "./handler";

const ROBOT_TABLE = "RobotTable";
const PARTNER_TABLE = "PartnerTable";
const CERTIFICATION_REQUEST_TABLE = "CertificationRequestTable";
const PLATFORM_SETTINGS_TABLE = "PlatformSettingsTable";

const ROBOT_ID = "robot-abc-123";
const PARTNER_USERNAME = "partner-cognito";
const PARTNER_TABLE_ID = "partner-uuid-456";

function makeEvent(overrides: { robotId?: string; username?: string } = {}) {
  return {
    arguments: {
      robotId: ROBOT_ID,
      ...overrides,
    },
    identity: {
      username: PARTNER_USERNAME,
    },
  } as unknown as Parameters<typeof handler>[0];
}

const noOpContext = {} as Context;
const noOpCallback = (): void => {};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ROBOT_TABLE_NAME = ROBOT_TABLE;
  process.env.PARTNER_TABLE_NAME = PARTNER_TABLE;
  process.env.CERTIFICATION_REQUEST_TABLE = CERTIFICATION_REQUEST_TABLE;
  process.env.PLATFORM_SETTINGS_TABLE = PLATFORM_SETTINGS_TABLE;
});

describe("createCertificationRequestLambda handler", () => {
  it("throws when robotId is missing", async () => {
    const event = makeEvent();
    (event as { arguments: Record<string, unknown> }).arguments = {};

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("robotId is required");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws when identity is missing", async () => {
    const event = makeEvent();
    delete (event as { identity?: unknown }).identity;

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("Unauthorized");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns error when robot not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toBe("Robot not found");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns error when robot is already Ctrlr Approved", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: "robot-uuid",
          robotId: ROBOT_ID,
          partnerId: PARTNER_TABLE_ID,
          modulrApproved: true,
        },
      ],
    });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toBe("Robot is already Modulr Approved");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns error when caller is not the robot owner", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            id: "robot-uuid",
            robotId: ROBOT_ID,
            partnerId: PARTNER_TABLE_ID,
            modulrApproved: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: { id: PARTNER_TABLE_ID, cognitoUsername: "different-owner" },
      });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toBe("Only the robot owner can request certification");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("returns error when an open certification request already exists", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            id: "robot-uuid",
            robotId: ROBOT_ID,
            partnerId: PARTNER_TABLE_ID,
            modulrApproved: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: { id: PARTNER_TABLE_ID, cognitoUsername: PARTNER_USERNAME },
      })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, status: "requested" }],
      });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toContain("already open");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("succeeds and creates certification request with fee from settings", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            id: "robot-uuid",
            robotId: ROBOT_ID,
            partnerId: PARTNER_TABLE_ID,
            modulrApproved: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: { id: PARTNER_TABLE_ID, cognitoUsername: PARTNER_USERNAME },
      })
      .mockResolvedValueOnce({ Items: [] }) // no open requests
      .mockResolvedValueOnce({
        Items: [{ settingValue: "1500" }],
      })
      .mockResolvedValueOnce(undefined); // PutCommand CertificationRequest

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.status).toBe("requested");
    expect(body.amountCredits).toBe(1500);
    expect(body.certificationRequestId).toBeDefined();
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("succeeds with default fee when setting is missing", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            id: "robot-uuid",
            robotId: ROBOT_ID,
            partnerId: PARTNER_TABLE_ID,
            modulrApproved: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: { id: PARTNER_TABLE_ID, cognitoUsername: PARTNER_USERNAME },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] }) // no platform setting
      .mockResolvedValueOnce(undefined);

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.amountCredits).toBe(1000); // default
    expect(mockSend).toHaveBeenCalledTimes(5);
  });
});
