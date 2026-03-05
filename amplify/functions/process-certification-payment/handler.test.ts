import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "aws-lambda";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: class GetCommand {},
  QueryCommand: class QueryCommand {},
  UpdateCommand: class UpdateCommand {},
  PutCommand: class PutCommand {},
}));

import { handler } from "./handler";

const CERTIFICATION_REQUEST_TABLE = "CertificationRequestTable";
const USER_CREDITS_TABLE = "UserCreditsTable";
const CREDIT_TRANSACTIONS_TABLE = "CreditTransactionsTable";
const PLATFORM_REVENUE_ENTRY_TABLE = "PlatformRevenueEntryTable";

const PARTNER_USERNAME = "partner-cognito";
const REQUEST_ID = "req-123";
const FEE = 1000;

function makeEvent(overrides: { certificationRequestId?: string; username?: string } = {}) {
  return {
    arguments: {
      certificationRequestId: REQUEST_ID,
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
  process.env.CERTIFICATION_REQUEST_TABLE = CERTIFICATION_REQUEST_TABLE;
  process.env.USER_CREDITS_TABLE = USER_CREDITS_TABLE;
  process.env.CREDIT_TRANSACTIONS_TABLE = CREDIT_TRANSACTIONS_TABLE;
  process.env.PLATFORM_REVENUE_ENTRY_TABLE = PLATFORM_REVENUE_ENTRY_TABLE;
});

describe("processCertificationPaymentLambda handler", () => {
  it("throws when certificationRequestId is missing", async () => {
    const event = makeEvent();
    (event as { arguments: Record<string, unknown> }).arguments = {};

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("certificationRequestId is required");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws when identity is missing", async () => {
    const event = makeEvent();
    delete (event as { identity?: unknown }).identity;

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("Unauthorized");
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

  it("returns error when request status is not 'requested'", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        id: REQUEST_ID,
        status: "paid",
        partnerUserId: PARTNER_USERNAME,
        amountCredits: FEE,
      },
    });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toContain("not in 'requested' state");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns error when caller is not the request owner", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        id: REQUEST_ID,
        status: "requested",
        partnerUserId: "other-partner",
        amountCredits: FEE,
      },
    });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toBe("Only the request owner can pay for certification");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns error when partner has insufficient credits", async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          id: REQUEST_ID,
          status: "requested",
          partnerUserId: PARTNER_USERNAME,
          amountCredits: FEE,
        },
      })
      .mockResolvedValueOnce({
        Items: [{ id: "credits-id", credits: 100 }],
      });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(false);
    expect(body.error).toBe("Insufficient credits");
    expect(body.currentCredits).toBe(100);
    expect(body.requiredCredits).toBe(FEE);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("succeeds: deducts credits, updates request to paid, creates transaction and revenue entry", async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          id: REQUEST_ID,
          status: "requested",
          partnerUserId: PARTNER_USERNAME,
          amountCredits: FEE,
        },
      })
      .mockResolvedValueOnce({
        Items: [{ id: "credits-record-id", credits: 5000 }],
      })
      .mockResolvedValueOnce(undefined) // UpdateCommand UserCredits
      .mockResolvedValueOnce(undefined) // PutCommand CreditTransaction
      .mockResolvedValueOnce(undefined) // UpdateCommand CertificationRequest
      .mockResolvedValueOnce(undefined); // PutCommand PlatformRevenueEntry

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.certificationRequestId).toBe(REQUEST_ID);
    expect(body.status).toBe("paid");
    expect(body.amountCredits).toBe(FEE);
    expect(body.newBalance).toBe(4000);

    expect(mockSend).toHaveBeenCalledTimes(6);
  });
});
