import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "aws-lambda";
import { handler } from "./handler";

const mockSend = vi.fn();

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  QueryCommand: class QueryCommand {},
}));

const PLATFORM_TABLE = "PlatformSettingsTable";
const USER_TABLE = "UserTermsAcceptanceTable";
const USER_ID = "user-xyz-789";

function makeEvent(username: string = USER_ID) {
  return {
    identity: { username },
  } as unknown as Parameters<typeof handler>[0];
}

const noOpContext = {} as Context;
const noOpCallback = (): void => {};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATFORM_SETTINGS_TABLE = PLATFORM_TABLE;
  process.env.USER_TERMS_ACCEPTANCE_TABLE = USER_TABLE;
});

describe("getTermsStatusLambda handler", () => {
  it("returns unauthorized when identity is missing", async () => {
    const event = makeEvent();
    delete (event as { identity?: unknown }).identity;

    await expect(handler(event, noOpContext, noOpCallback)).rejects.toThrow("Unauthorized");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns mustAccept true when user has no acceptance record", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.currentVersion).toBe("1.0");
    expect(body.mustAccept).toBe(true);
    expect(body.acceptedVersion).toBeNull();
    expect(body.acceptedAt).toBeNull();
  });

  it("returns mustAccept false when user has accepted current version", async () => {
    const now = new Date().toISOString();
    mockSend
      .mockResolvedValueOnce({ Items: [{ settingValue: "1.0" }] })
      .mockResolvedValueOnce({ Items: [{ settingValue: "2025-02-18" }] })
      .mockResolvedValueOnce({
        Items: [
          {
            userId: USER_ID,
            acceptedTermsVersion: "1.0",
            acceptedTermsAt: now,
          },
        ],
      });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.currentVersion).toBe("1.0");
    expect(body.currentLastUpdatedAt).toBe("2025-02-18");
    expect(body.mustAccept).toBe(false);
    expect(body.acceptedVersion).toBe("1.0");
    expect(body.acceptedAt).toBe(now);
  });

  it("returns mustAccept true when user accepted an older version", async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ settingValue: "2.0" }] })
      .mockResolvedValueOnce({ Items: [{ settingValue: "2025-03-01" }] })
      .mockResolvedValueOnce({
        Items: [
          {
            userId: USER_ID,
            acceptedTermsVersion: "1.0",
            acceptedTermsAt: "2025-02-18T00:00:00.000Z",
          },
        ],
      });

    const result = await handler(makeEvent(), noOpContext, noOpCallback);
    const body = JSON.parse(result as string);

    expect(body.success).toBe(true);
    expect(body.currentVersion).toBe("2.0");
    expect(body.mustAccept).toBe(true);
    expect(body.acceptedVersion).toBe("1.0");
  });
});
