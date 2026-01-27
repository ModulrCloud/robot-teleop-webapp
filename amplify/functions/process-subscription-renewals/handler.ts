import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const SOCIAL_PROFILE_TABLE = process.env.SOCIAL_PROFILE_TABLE!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;

// Subscription pricing (in MTR credits)
const SUBSCRIPTION_PRICING = {
  monthly: 399,   // $3.99/mo
  annual: 4000,   // $40/yr
};

const OG_PRICING = {
  monthly: 399,
  annual: 4000,
};

/**
 * Processes subscription renewals and scheduled subscriptions
 * 
 * This Lambda runs on a schedule (daily) to:
 * 1. Activate pending subscriptions that should start today
 * 2. Handle expired subscriptions (gracefully expire if no credits)
 * 3. Process renewals for active subscriptions
 * 
 * Graceful expiration: If user doesn't have credits, subscription expires
 * but they're not "kicked" - they just lose Pro features until they resubscribe
 */
export const handler = async () => {
  console.log("=== SUBSCRIPTION RENEWAL PROCESSOR START ===");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log("Processing renewals for date range:", today.toISOString(), "to", tomorrow.toISOString());

  let processedCount = 0;
  let activatedCount = 0;
  let expiredCount = 0;
  let errorCount = 0;

  try {
    // 1. Find all profiles with pending subscriptions that should start today
    console.log("Step 1: Finding profiles with pending subscriptions...");
    
    // Note: We'll need to scan and filter, or use a GSI if we add one
    // For now, we'll scan and filter by pendingSubscriptionStartsAt
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: SOCIAL_PROFILE_TABLE,
        FilterExpression: 'attribute_exists(pendingSubscriptionPlan) AND attribute_exists(pendingSubscriptionStartsAt)',
        ProjectionExpression: 'id, cognitoId, username, pendingSubscriptionPlan, pendingSubscriptionStartsAt, subscriptionStatus, subscriptionExpiresAt, isOgPricing, subscriptionStartedAt, tenureMonthsAccumulated, tenureStartedAt',
      })
    );

    const profilesWithPending = scanResult.Items || [];
    console.log(`Found ${profilesWithPending.length} profiles with pending subscriptions`);

    // 2. Process each pending subscription that should start today
    for (const profile of profilesWithPending) {
      try {
        const pendingStartsAt = profile.pendingSubscriptionStartsAt;
        if (!pendingStartsAt) continue;

        const startDate = new Date(pendingStartsAt);
        const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

        // Check if this subscription should start today
        if (startDateOnly.getTime() !== today.getTime()) {
          continue; // Not today, skip
        }

        console.log(`Processing pending subscription for profile ${profile.id}, username: ${profile.username}`);

        const plan = profile.pendingSubscriptionPlan as 'monthly' | 'annual';
        const isOgPricing = profile.isOgPricing === true;
        const pricing = isOgPricing ? OG_PRICING : SUBSCRIPTION_PRICING;
        const price = pricing[plan];

        // Get user's credits
        const creditsQuery = await docClient.send(
          new QueryCommand({
            TableName: USER_CREDITS_TABLE,
            IndexName: 'userIdIndex',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
              ':userId': profile.cognitoId,
            },
            Limit: 1,
          })
        );

        const creditsRecord = creditsQuery.Items?.[0];
        const currentCredits = creditsRecord?.credits || 0;

        if (!creditsRecord) {
          // No credits record - gracefully expire subscription
          console.log(`No credits record found for ${profile.username}. Gracefully expiring subscription.`);
          
          await docClient.send(
            new UpdateCommand({
              TableName: SOCIAL_PROFILE_TABLE,
              Key: { id: profile.id },
              UpdateExpression: `SET 
                subscriptionStatus = :status,
                pendingSubscriptionPlan = :nullPlan,
                pendingSubscriptionStartsAt = :nullStart,
                isOgPricing = :false,
                updatedAt = :updatedAt`,
              ExpressionAttributeValues: {
                ':status': 'expired',
                ':nullPlan': null,
                ':nullStart': null,
                ':false': false,
                ':updatedAt': now.toISOString(),
              },
            })
          );

          expiredCount++;
          console.log(`Subscription expired for ${profile.username} due to missing credits record (graceful expiration - user can resubscribe anytime)`);
          continue;
        }

        if (currentCredits < price) {
          // Insufficient credits - gracefully expire subscription
          // User is NOT "kicked" - they just lose Pro features until they resubscribe
          // OG pricing is also lost when subscription expires
          console.log(`Insufficient credits for ${profile.username}. Current: ${currentCredits}, Required: ${price}. Gracefully expiring subscription.`);
          
          await docClient.send(
            new UpdateCommand({
              TableName: SOCIAL_PROFILE_TABLE,
              Key: { id: profile.id },
              UpdateExpression: `SET 
                subscriptionStatus = :status,
                pendingSubscriptionPlan = :nullPlan,
                pendingSubscriptionStartsAt = :nullStart,
                isOgPricing = :false,
                updatedAt = :updatedAt`,
              ExpressionAttributeValues: {
                ':status': 'expired',
                ':nullPlan': null,
                ':nullStart': null,
                ':false': false,
                ':updatedAt': now.toISOString(),
              },
            })
          );

          expiredCount++;
          console.log(`Subscription expired for ${profile.username} due to insufficient credits (graceful expiration - user can resubscribe anytime)`);
          continue;
        }

        // Deduct credits
        const newCredits = currentCredits - price;
        await docClient.send(
          new UpdateCommand({
            TableName: USER_CREDITS_TABLE,
            Key: { id: creditsRecord.id },
            UpdateExpression: 'SET credits = :credits, lastUpdated = :now',
            ExpressionAttributeValues: {
              ':credits': newCredits,
              ':now': now.toISOString(),
            },
          })
        );

        // Create transaction record
        const transactionId = randomUUID();
        await docClient.send(
          new PutCommand({
            TableName: CREDIT_TRANSACTIONS_TABLE,
            Item: {
              id: transactionId,
              userId: profile.cognitoId,
              amount: price,
              transactionType: 'subscription_purchase',
              description: `Pro subscription: ${plan} plan (scheduled activation)`,
              relatedEntity: profile.id,
              createdAt: now.toISOString(),
            },
          })
        );

        // Calculate new expiration date
        let subscriptionExpiresAt: Date;
        if (plan === 'monthly') {
          subscriptionExpiresAt = new Date(startDate);
          subscriptionExpiresAt.setMonth(subscriptionExpiresAt.getMonth() + 1);
        } else {
          subscriptionExpiresAt = new Date(startDate);
          subscriptionExpiresAt.setFullYear(subscriptionExpiresAt.getFullYear() + 1);
        }

        // Calculate tenure
        const previousTenureMonths = profile.tenureMonthsAccumulated || 0;
        const tenureStartedAt = profile.tenureStartedAt || startDate.toISOString();

        // Activate subscription
        await docClient.send(
          new UpdateCommand({
            TableName: SOCIAL_PROFILE_TABLE,
            Key: { id: profile.id },
            UpdateExpression: `SET 
              subscriptionStatus = :status,
              subscriptionPlan = :plan,
              subscriptionStartedAt = :startedAt,
              subscriptionExpiresAt = :expiresAt,
              pendingSubscriptionPlan = :nullPlan,
              pendingSubscriptionStartsAt = :nullStart,
              tenureStartedAt = :tenureStartedAt,
              tenureMonthsAccumulated = :tenureMonths,
              updatedAt = :updatedAt`,
            ExpressionAttributeValues: {
              ':status': 'active',
              ':plan': plan,
              ':startedAt': startDate.toISOString(),
              ':expiresAt': subscriptionExpiresAt.toISOString(),
              ':nullPlan': null,
              ':nullStart': null,
              ':tenureStartedAt': tenureStartedAt,
              ':tenureMonths': previousTenureMonths,
              ':updatedAt': now.toISOString(),
            },
          })
        );

        activatedCount++;
        console.log(`Subscription activated for ${profile.username}. Plan: ${plan}, Expires: ${subscriptionExpiresAt.toISOString()}`);
        processedCount++;

      } catch (error) {
        errorCount++;
        console.error(`Error processing profile ${profile.id}:`, error);
        // Continue processing other profiles
      }
    }

    // 3. Find and handle expired subscriptions (that don't have pending subscriptions)
    console.log("Step 2: Finding expired subscriptions...");
    
    const expiredScanResult = await docClient.send(
      new ScanCommand({
        TableName: SOCIAL_PROFILE_TABLE,
        FilterExpression: 'subscriptionStatus IN (:active, :trial) AND subscriptionExpiresAt < :now',
        ExpressionAttributeValues: {
          ':active': 'active',
          ':trial': 'trial',
          ':now': now.toISOString(),
        },
        ProjectionExpression: 'id, cognitoId, username, subscriptionStatus, subscriptionExpiresAt, pendingSubscriptionPlan',
      })
    );

    const expiredProfiles = expiredScanResult.Items || [];
    console.log(`Found ${expiredProfiles.length} expired subscriptions`);

    for (const profile of expiredProfiles) {
      try {
        // If they have a pending subscription, don't expire yet - it will be processed above
        if (profile.pendingSubscriptionPlan) {
          console.log(`Profile ${profile.id} has expired but pending subscription exists - skipping expiration`);
          continue;
        }

        // Gracefully expire (no "kicking" - just set status to expired)
        // OG pricing is also lost when subscription expires
        await docClient.send(
          new UpdateCommand({
            TableName: SOCIAL_PROFILE_TABLE,
            Key: { id: profile.id },
            UpdateExpression: `SET 
              subscriptionStatus = :status,
              isOgPricing = :false,
              updatedAt = :updatedAt`,
            ExpressionAttributeValues: {
              ':status': 'expired',
              ':false': false,
              ':updatedAt': now.toISOString(),
            },
          })
        );

        expiredCount++;
        console.log(`Subscription expired for ${profile.username} (graceful expiration)`);
        processedCount++;

      } catch (error) {
        errorCount++;
        console.error(`Error expiring profile ${profile.id}:`, error);
      }
    }

    console.log("=== SUBSCRIPTION RENEWAL PROCESSOR COMPLETE ===");
    console.log(`Processed: ${processedCount}, Activated: ${activatedCount}, Expired: ${expiredCount}, Errors: ${errorCount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        processed: processedCount,
        activated: activatedCount,
        expired: expiredCount,
        errors: errorCount,
        timestamp: now.toISOString(),
      }),
    };

  } catch (error) {
    console.error("=== SUBSCRIPTION RENEWAL PROCESSOR ERROR ===");
    console.error("Error:", error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to process subscription renewals",
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
