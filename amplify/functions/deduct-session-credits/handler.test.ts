import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { SESSION_END_REASON } from "../shared/session-end-reasons";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: class GetCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  QueryCommand: class QueryCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  UpdateCommand: class UpdateCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  PutCommand: class PutCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

import { handler } from "./handler";

const SESSION_TABLE = "SessionTable";
const USER_CREDITS_TABLE = "UserCreditsTable";
const CREDIT_TRANSACTIONS_TABLE = "CreditTransactionsTable";
const ROBOT_TABLE = "RobotTable";
const PARTNER_TABLE = "PartnerTable";
const PLATFORM_SETTINGS_TABLE = "PlatformSettingsTable";

const OWNER_USERNAME = "owner-cognito-username";
const SESSION_ID = "session-test-123";
const ROBOT_ID = "robot-abc";

function makeEvent(overrides: { sessionId?: string; username?: string; groups?: string[] } = {}) {
  return {
    arguments: {
      sessionId: SESSION_ID,
      ...overrides,
    },
    identity: {
      username: OWNER_USERNAME,
      groups: [] as string[],
      ...overrides,
    },
  } as unknown as Parameters<typeof handler>[0];
}

/** Session where userId === partnerId (robot owner) – should not be charged */
function makeOwnerSession() {
  return {
    id: SESSION_ID,
    userId: OWNER_USERNAME,
    partnerId: OWNER_USERNAME,
    robotId: ROBOT_ID,
    status: "active",
    startedAt: "2025-01-01T00:00:00.000Z",
    creditsDeductedSoFar: 0,
  };
}

/** Session where userId !== partnerId (regular paying user) */
function makeNonOwnerSession() {
  return {
    id: SESSION_ID,
    userId: "other-user",
    partnerId: OWNER_USERNAME,
    robotId: ROBOT_ID,
    status: "active",
    startedAt: "2025-01-01T00:00:00.000Z",
    creditsDeductedSoFar: 0,
  };
}

const noOpContext = {} as Context;
const noOpCallback = (): void => {};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_TABLE_NAME = SESSION_TABLE;
  process.env.USER_CREDITS_TABLE = USER_CREDITS_TABLE;
  process.env.CREDIT_TRANSACTIONS_TABLE = CREDIT_TRANSACTIONS_TABLE;
  process.env.ROBOT_TABLE_NAME = ROBOT_TABLE;
  process.env.PARTNER_TABLE_NAME = PARTNER_TABLE;
  process.env.PLATFORM_SETTINGS_TABLE = PLATFORM_SETTINGS_TABLE;
  process.env.USER_ROBOT_TRIAL_CONSUMPTION_TABLE_NAME = "UserRobotTrialConsumptionTable";
});

describe("deductSessionCreditsLambda handler", () => {
  it("returns 200 with zero credits deducted when session user is the robot owner (userId matches partner cognitoUsername)", async () => {
    const session = makeOwnerSession();
    const partnerTableId = "partner-uuid-123";
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);

    expect(result).toBeDefined();
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Owner test - no credits deducted");
    expect(body.creditsDeducted).toBe(0);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.totalDeductedSoFar).toBe(0);
    expect(body.remainingCredits).toBe(0);

    // Session + robot + partner (no user credits or deduction)
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("returns 200 with zero credits deducted when session userId is partner contactEmail", async () => {
    const session = makeOwnerSession();
    session.userId = "owner@example.com";
    session.status = "active";
    const partnerTableId = "partner-uuid-123";
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      });

    const result = await handler(
      makeEvent({ username: "owner@example.com" }),
      noOpContext,
      noOpCallback
    );

    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.creditsDeducted).toBe(0);
    expect(body.message).toBe("Owner test - no credits deducted");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("fetches robot and proceeds to billing when session user is not the owner (userId !== partnerId)", async () => {
    const session = makeNonOwnerSession();
    const partnerTableId = "partner-uuid-123";
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 100 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      })
      .mockResolvedValueOnce({
        Items: [{ settingKey: "platformMarkupPercent", settingValue: "30" }],
      })
      .mockResolvedValueOnce({
        Items: [{ id: "user-credits-id", userId: "other-user", credits: 500 }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );

    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.creditsDeducted).toBeGreaterThan(0);

    // Session + robot + partner (owner check) + platform settings + user credits query + update credits + put transaction + update session = 8
    expect(mockSend).toHaveBeenCalledTimes(8);
  });

  it("throws when sessionId is missing", async () => {
    await expect(
      handler(makeEvent({ sessionId: undefined }), noOpContext, noOpCallback)
    ).rejects.toThrow("Missing required argument");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws when identity is missing", async () => {
    const event = makeEvent();
    delete (event as { identity?: unknown }).identity;

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow(
      "Unauthorized"
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns 500 when session is not found", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.details).toContain("Session not found");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with no deduction when session is not active", async () => {
    const session = makeOwnerSession();
    session.status = "completed";
    mockSend.mockResolvedValueOnce({ Item: session });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);

    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("not active");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when caller identity does not own the session (not session userId and not admin)", async () => {
    const session = makeNonOwnerSession();
    mockSend.mockResolvedValueOnce({ Item: session });

    // Caller says they are "random-user" but session belongs to "other-user"
    const result = await handler(
      makeEvent({ username: "random-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.details).toContain("Unauthorized");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns 402 free_cap_exceeded when free robot session passes max length (snapshot)", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 125_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 0,
      maxFreeSessionSeconds: 120,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 0 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      })
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(402);
    const body = JSON.parse(res.body);
    expect(body.terminationReason).toBe("free_cap_exceeded");
    expect(mockSend).toHaveBeenCalledTimes(4);
    const terminalUpdate = mockSend.mock.calls
      .map((c) => c[0] as { input?: { ExpressionAttributeValues?: Record<string, string> } })
      .find((cmd) => cmd.input?.ExpressionAttributeValues?.[":endReason"] != null);
    expect(terminalUpdate?.input?.ExpressionAttributeValues?.[":endReason"]).toBe(
      SESSION_END_REASON.FREE_CAP_EXCEEDED
    );
  });

  it("returns 200 for free robot under max length cap", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 30_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 0,
      maxFreeSessionSeconds: 120,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 0 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      });

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("free");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("returns 200 for unlimited free robot (no cap on session or robot)", async () => {
    const partnerTableId = "partner-uuid-123";
    const session = {
      ...makeNonOwnerSession(),
      hourlyRateCredits: 0,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 0 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      });

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("explicit session maxFreeSessionSeconds 0 (unlimited snapshot) ignores robot cap", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 125_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 0,
      maxFreeSessionSeconds: 0,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [
          {
            robotId: ROBOT_ID,
            partnerId: partnerTableId,
            hourlyRateCredits: 0,
            maxFreeSessionSeconds: 120,
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      });

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("returns 402 and records endReason when insufficient credits after trial", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 125_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 100,
      trialSeconds: 120,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 100 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      })
      .mockResolvedValueOnce({
        Items: [{ settingKey: "platformMarkupPercent", settingValue: "30" }],
      })
      .mockResolvedValueOnce({
        Items: [{ id: "user-credits-id", userId: "other-user", credits: 0 }],
      })
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(402);
    const terminalUpdate = mockSend.mock.calls
      .map((c) => c[0] as { input?: { ExpressionAttributeValues?: Record<string, string> } })
      .find((cmd) => cmd.input?.ExpressionAttributeValues?.[":endReason"] != null);
    expect(terminalUpdate?.input?.ExpressionAttributeValues?.[":endReason"]).toBe(
      SESSION_END_REASON.INSUFFICIENT_FUNDS
    );
    expect(terminalUpdate?.input?.ExpressionAttributeValues?.[":status"]).toBe("insufficient_funds");
  });

  it("returns 200 skipped when free-cap update races terminal session", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 125_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 0,
      maxFreeSessionSeconds: 120,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 0 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      })
      .mockRejectedValueOnce(
        new ConditionalCheckFailedException({
          message: "The conditional request failed",
          $metadata: {},
        })
      );

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.skipped).toBe(true);
  });

  it("returns 200 with no charge while session is in paid trial window", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 30_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 100,
      trialSeconds: 120,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 100 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      })
      .mockResolvedValueOnce({
        Items: [{ id: "user-credits-id", userId: "other-user", credits: 500 }],
      });

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.creditsDeducted).toBe(0);
    expect(body.trialActive).toBe(true);
    expect(body.remainingCredits).toBe(500);
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it("charges normally after paid trial window elapses", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 125_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 100,
      trialSeconds: 120,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [{ robotId: ROBOT_ID, partnerId: partnerTableId, hourlyRateCredits: 100 }],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      })
      .mockResolvedValueOnce({
        Items: [{ settingKey: "platformMarkupPercent", settingValue: "30" }],
      })
      .mockResolvedValueOnce({
        Items: [{ id: "user-credits-id", userId: "other-user", credits: 500 }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.creditsDeducted).toBeGreaterThan(0);
    // +1 Put to UserRobotTrialConsumption after first paid minute (session had trialSeconds > 0)
    expect(mockSend).toHaveBeenCalledTimes(9);
  });

  it("does not write trial consumption when robot has trialOnePerCustomer false", async () => {
    const partnerTableId = "partner-uuid-123";
    const started = new Date(Date.now() - 125_000).toISOString();
    const session = {
      ...makeNonOwnerSession(),
      startedAt: started,
      hourlyRateCredits: 100,
      trialSeconds: 120,
    };
    mockSend
      .mockResolvedValueOnce({ Item: session })
      .mockResolvedValueOnce({
        Items: [
          {
            robotId: ROBOT_ID,
            partnerId: partnerTableId,
            hourlyRateCredits: 100,
            trialOnePerCustomer: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: { id: partnerTableId, cognitoUsername: OWNER_USERNAME, contactEmail: "owner@example.com" },
      })
      .mockResolvedValueOnce({
        Items: [{ settingKey: "platformMarkupPercent", settingValue: "30" }],
      })
      .mockResolvedValueOnce({
        Items: [{ id: "user-credits-id", userId: "other-user", credits: 500 }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await handler(
      makeEvent({ username: "other-user" }),
      noOpContext,
      noOpCallback
    );
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(8);
  });
});
