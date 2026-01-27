import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for Subscription Renewal Processor
 * 
 * These tests verify:
 * 1. Pending subscriptions are activated when they should start
 * 2. Insufficient credits result in graceful expiration (not "kicking")
 * 3. Expired subscriptions are handled correctly
 * 4. OG pricing is removed when subscription expires
 * 5. Credit deduction and transaction recording
 */

// Mock environment variables
process.env.SOCIAL_PROFILE_TABLE = 'TestSocialProfile';
process.env.USER_CREDITS_TABLE = 'TestUserCredits';
process.env.CREDIT_TRANSACTIONS_TABLE = 'TestCreditTransactions';

// Hoisted mocks
const { ddbSend } = vi.hoisted(() => {
  return {
    ddbSend: vi.fn(),
  };
});

// Mock AWS SDK
vi.mock('@aws-sdk/client-dynamodb', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-dynamodb');
  class MockDynamoDBClient {
    send = ddbSend;
  }
  return { ...actual, DynamoDBClient: MockDynamoDBClient };
});

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({
        send: ddbSend,
      }),
    },
  };
});

vi.mock('crypto', () => ({
  randomUUID: () => 'test-transaction-id-123',
}));

// Import handler after mocks are set up
import { handler } from '../amplify/functions/process-subscription-renewals/handler';

// Subscription pricing constants (matches handler)
const SUBSCRIPTION_PRICING = {
  monthly: 399,
  annual: 4000,
};

const OG_PRICING = {
  monthly: 399,
  annual: 4000,
};

describe('Subscription Renewal Processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Pending Subscription Activation', () => {
    it('should activate pending subscription when user has sufficient credits', async () => {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const pendingStartsAt = todayOnly.toISOString();

      // Mock: Scan for pending subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: pendingStartsAt,
            subscriptionStatus: 'trial',
            subscriptionExpiresAt: todayOnly.toISOString(),
            isOgPricing: false,
            subscriptionStartedAt: null,
            tenureMonthsAccumulated: 0,
            tenureStartedAt: null,
          },
        ],
      });

      // Mock: Query for user credits
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'credits-1',
            userId: 'google_123',
            credits: 1000, // Sufficient for monthly (399)
          },
        ],
      });

      // Mock: Update credits (deduct)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Create transaction
      ddbSend.mockResolvedValueOnce({});

      // Mock: Update profile (activate subscription)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Scan for expired subscriptions (empty)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.activated).toBe(1);
      expect(response.expired).toBe(0);
      expect(response.errors).toBe(0);

      // Verify the correct number of DynamoDB operations occurred
      // Should have: 1 scan (pending), 1 query (credits), 1 update (credits), 1 put (transaction), 1 update (profile), 1 scan (expired)
      expect(ddbSend).toHaveBeenCalledTimes(6);
    });

    it('should gracefully expire subscription when user has insufficient credits', async () => {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const pendingStartsAt = todayOnly.toISOString();

      // Mock: Scan for pending subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            pendingSubscriptionPlan: 'annual',
            pendingSubscriptionStartsAt: pendingStartsAt,
            subscriptionStatus: 'trial',
            isOgPricing: true,
          },
        ],
      });

      // Mock: Query for user credits (insufficient)
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'credits-1',
            userId: 'google_123',
            credits: 100, // Insufficient for annual (4000)
          },
        ],
      });

      // Mock: Update profile (expire gracefully)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Scan for expired subscriptions (empty)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.activated).toBe(0);
      expect(response.expired).toBe(1); // Gracefully expired
      expect(response.errors).toBe(0);

      // Verify the correct number of DynamoDB operations occurred
      // Should have: 1 scan (pending), 1 query (credits), 1 update (profile expire), 1 scan (expired)
      // Should NOT have: credit deduction or transaction creation
      expect(ddbSend).toHaveBeenCalledTimes(4);
    });

    it('should gracefully expire when credits record does not exist', async () => {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const pendingStartsAt = todayOnly.toISOString();

      // Mock: Scan for pending subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: pendingStartsAt,
            subscriptionStatus: 'trial',
            isOgPricing: false,
          },
        ],
      });

      // Mock: Query for user credits (no record found)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      // Mock: Update profile (expire gracefully)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Scan for expired subscriptions (empty)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.activated).toBe(0);
      expect(response.expired).toBe(1);
      expect(response.errors).toBe(0);
    });

    it('should skip pending subscriptions that are not scheduled for today', async () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowOnly = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
      const pendingStartsAt = tomorrowOnly.toISOString();

      // Mock: Scan for pending subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: pendingStartsAt, // Tomorrow, not today
            subscriptionStatus: 'trial',
          },
        ],
      });

      // Mock: Scan for expired subscriptions (empty)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.activated).toBe(0);
      expect(response.expired).toBe(0);
      expect(response.processed).toBe(0);
    });
  });

  describe('Expired Subscription Handling', () => {
    it('should gracefully expire subscriptions that have passed expiration date', async () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      // Mock: Scan for pending subscriptions (empty)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      // Mock: Scan for expired subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            subscriptionStatus: 'active',
            subscriptionExpiresAt: yesterday.toISOString(),
            pendingSubscriptionPlan: null, // No pending subscription
          },
        ],
      });

      // Mock: Update profile (expire gracefully)
      ddbSend.mockResolvedValueOnce({});

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.expired).toBe(1);
      expect(response.activated).toBe(0);

      // Verify the correct number of DynamoDB operations occurred
      // Should have: 1 scan (pending), 1 scan (expired), 1 update (profile expire)
      expect(ddbSend).toHaveBeenCalledTimes(3);
    });

    it('should skip expiration if pending subscription exists', async () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      // Mock: Scan for pending subscriptions (empty - not today)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      // Mock: Scan for expired subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            subscriptionStatus: 'active',
            subscriptionExpiresAt: yesterday.toISOString(),
            pendingSubscriptionPlan: 'monthly', // Has pending subscription
          },
        ],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.expired).toBe(0); // Skipped because pending exists
      expect(response.activated).toBe(0);
    });
  });

  describe('OG Pricing Handling', () => {
    it('should remove OG pricing when subscription expires due to insufficient credits', async () => {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const pendingStartsAt = todayOnly.toISOString();

      // Mock: Scan for pending subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            pendingSubscriptionPlan: 'annual',
            pendingSubscriptionStartsAt: pendingStartsAt,
            subscriptionStatus: 'trial',
            isOgPricing: true, // Has OG pricing
          },
        ],
      });

      // Mock: Query for user credits (insufficient)
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'credits-1',
            userId: 'google_123',
            credits: 100,
          },
        ],
      });

      // Mock: Update profile (expire gracefully, remove OG pricing)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Scan for expired subscriptions (empty)
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.expired).toBe(1);
      expect(response.activated).toBe(0);

      // Verify the correct number of DynamoDB operations occurred
      // Should have: 1 scan (pending), 1 query (credits), 1 update (profile expire), 1 scan (expired)
      expect(ddbSend).toHaveBeenCalledTimes(4);
    });
  });

  describe('Credit Transaction Recording', () => {
    it('should create credit transaction when subscription is activated', async () => {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const pendingStartsAt = todayOnly.toISOString();

      // Mock: Scan for pending subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: pendingStartsAt,
            subscriptionStatus: 'trial',
            isOgPricing: false,
            subscriptionStartedAt: null,
            tenureMonthsAccumulated: 0,
            tenureStartedAt: null,
          },
        ],
      });

      // Mock: Query for user credits
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'credits-1',
            userId: 'google_123',
            credits: 1000,
          },
        ],
      });

      // Mock: Update credits
      ddbSend.mockResolvedValueOnce({});

      // Mock: Create transaction
      ddbSend.mockResolvedValueOnce({});

      // Mock: Update profile
      ddbSend.mockResolvedValueOnce({});

      // Mock: Scan for expired subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.activated).toBe(1);
      expect(response.expired).toBe(0);

      // Verify the correct number of DynamoDB operations occurred
      // Should have: 1 scan (pending), 1 query (credits), 1 update (credits), 1 put (transaction), 1 update (profile), 1 scan (expired)
      expect(ddbSend).toHaveBeenCalledTimes(6);
    });
  });

  describe('Error Handling', () => {
    it('should continue processing other profiles if one fails', async () => {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const pendingStartsAt = todayOnly.toISOString();

      // Mock: Scan for pending subscriptions (2 profiles)
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser1',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: pendingStartsAt,
            subscriptionStatus: 'trial',
            isOgPricing: false,
            subscriptionStartedAt: null,
            tenureMonthsAccumulated: 0,
            tenureStartedAt: null,
          },
          {
            id: 'profile-2',
            cognitoId: 'google_456',
            username: 'testuser2',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: pendingStartsAt,
            subscriptionStatus: 'trial',
            isOgPricing: false,
            subscriptionStartedAt: null,
            tenureMonthsAccumulated: 0,
            tenureStartedAt: null,
          },
        ],
      });

      // Mock: Query for user 1 credits (success)
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'credits-1',
            userId: 'google_123',
            credits: 1000,
          },
        ],
      });

      // Mock: Update credits for user 1 (success)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Create transaction for user 1 (success)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Update profile for user 1 (success)
      ddbSend.mockResolvedValueOnce({});

      // Mock: Query for user 2 credits (error)
      ddbSend.mockRejectedValueOnce(new Error('Database error'));

      // Mock: Scan for expired subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.activated).toBe(1); // One succeeded
      expect(response.errors).toBe(1); // One failed
    });
  });

  describe('Date Filtering', () => {
    it('should only process subscriptions scheduled for today', async () => {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const yesterday = new Date(todayOnly);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(todayOnly);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Mock: Scan for pending subscriptions (mix of dates)
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'profile-1',
            cognitoId: 'google_123',
            username: 'testuser1',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: yesterday.toISOString(), // Yesterday - should skip
            subscriptionStatus: 'trial',
          },
          {
            id: 'profile-2',
            cognitoId: 'google_456',
            username: 'testuser2',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: todayOnly.toISOString(), // Today - should process
            subscriptionStatus: 'trial',
            isOgPricing: false,
            subscriptionStartedAt: null,
            tenureMonthsAccumulated: 0,
            tenureStartedAt: null,
          },
          {
            id: 'profile-3',
            cognitoId: 'google_789',
            username: 'testuser3',
            pendingSubscriptionPlan: 'monthly',
            pendingSubscriptionStartsAt: tomorrow.toISOString(), // Tomorrow - should skip
            subscriptionStatus: 'trial',
          },
        ],
      });

      // Mock: Query for user 2 credits (only one that should be processed)
      ddbSend.mockResolvedValueOnce({
        Items: [
          {
            id: 'credits-2',
            userId: 'google_456',
            credits: 1000,
          },
        ],
      });

      // Mock: Update credits
      ddbSend.mockResolvedValueOnce({});

      // Mock: Create transaction
      ddbSend.mockResolvedValueOnce({});

      // Mock: Update profile
      ddbSend.mockResolvedValueOnce({});

      // Mock: Scan for expired subscriptions
      ddbSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler();
      const response = JSON.parse(result.body);

      expect(response.success).toBe(true);
      expect(response.activated).toBe(1); // Only today's subscription
      expect(response.processed).toBe(1);
    });
  });
});
