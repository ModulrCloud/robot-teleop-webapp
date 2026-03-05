import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "aws-lambda";
import { handler } from "./handler";

const mockSend = vi.fn();

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  QueryCommand: class QueryCommand {},
  PutCommand: class PutCommand {},
}));

const USER_TABLE = "UserTermsAcceptanceTable";
const USER_ID = "user-abc-123";
const TERMS_VERSION = "1.0";

function makeEvent(overrides: { termsVersion?: string; username?: string } = {}) {
  return {
    arguments: {
      termsVersion: TERMS_VERSION,
      ...overrides,
    },
    identity: {
      username: USER_ID,
      ...overrides,
    },
  } as unknown as Parameters<typeof handler>[0];
}

const noOpContext = {} as Context;
const noOpCallback = (): void => {};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.USER_TERMS_ACCEPTANCE_TABLE = USER_TABLE;
});

describe("acceptTermsLambda handler", () => {
  it("returns unauthorized when identity is missing", async () => {
    const event = makeEvent();
    delete (event as { identity?: unknown }).identity;

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("Unauthorized");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns unauthorized when username is missing", async () => {
    const event = makeEvent();
    (event.identity as { username?: string }).username = undefined;

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("Unauthorized");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws when termsVersion is missing", async () => {
    const event = makeEvent({ termsVersion: undefined as unknown as string });

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("Missing required");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("queries existing record then puts with same id when user already has acceptance", async () => {
    const existingId = "existing-id-456";
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            id: existingId,
            userId: USER_ID,
            acceptedTermsVersion: "0.9",
            acceptedTermsAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({});

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.acceptedTermsVersion).toBe(TERMS_VERSION);
    expect(body.acceptedTermsAt).toBeDefined();

    expect(mockSend).toHaveBeenCalledTimes(2);
    const putArg = mockSend.mock.calls[1][0];
    const item = putArg?.input?.Item ?? (putArg as { Item?: Record<string, unknown> })?.Item;
    expect(item?.id).toBe(existingId);
    expect(item?.userId).toBe(USER_ID);
    expect(item?.acceptedTermsVersion).toBe(TERMS_VERSION);
  });

  it("queries empty then puts new record when user has no acceptance yet", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.acceptedTermsVersion).toBe(TERMS_VERSION);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const putArg = mockSend.mock.calls[1][0];
    const item = putArg?.input?.Item ?? (putArg as { Item?: Record<string, unknown> })?.Item;
    expect(item?.userId).toBe(USER_ID);
    expect(item?.acceptedTermsVersion).toBe(TERMS_VERSION);
    expect(item?.id).toBeDefined();
  });
});
