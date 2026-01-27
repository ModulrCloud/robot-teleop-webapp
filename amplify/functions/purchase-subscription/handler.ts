import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const SOCIAL_PROFILE_TABLE = process.env.SOCIAL_PROFILE_TABLE!;

// Subscription pricing (in MTR credits)
// Conversion: 1 USD = 100 MTR
const SUBSCRIPTION_PRICING = {
  monthly: 399,   // $3.99/mo
  annual: 4000,   // $40/yr (~$3.33/mo)
};

// OG pricing (same for now, but can be different in the future)
const OG_PRICING = {
  monthly: 399,
  annual: 4000,
};

type SubscriptionPlan = 'monthly' | 'annual';

export const handler: Schema["purchaseSubscriptionLambda"]["functionHandler"] = async (event) => {
  console.log("=== PURCHASE SUBSCRIPTION LAMBDA START ===");
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    // 1. Get user identity
    const identity = event.identity;
    if (!identity || !("username" in identity)) {
      console.log("No valid identity found");
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: "Unauthorized" }),
      };
    }

    const cognitoId = identity.username;
    console.log("User cognitoId:", cognitoId);

    // 2. Validate plan
    const plan = event.arguments.plan as SubscriptionPlan;
    if (!plan || !['monthly', 'annual'].includes(plan)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "Invalid plan. Must be 'monthly' or 'annual'" }),
      };
    }
    console.log("Requested plan:", plan);

    // 3. Get user's social profile
    console.log("Fetching social profile...");
    const profileQuery = await docClient.send(
      new QueryCommand({
        TableName: SOCIAL_PROFILE_TABLE,
        IndexName: 'cognitoIdIndex',
        KeyConditionExpression: 'cognitoId = :cognitoId',
        ExpressionAttributeValues: {
          ':cognitoId': cognitoId,
        },
        Limit: 1,
      })
    );

    const profile = profileQuery.Items?.[0];
    if (!profile) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "Profile not found. Please register a username first." }),
      };
    }

    if (!profile.username) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "You must register a username before subscribing." }),
      };
    }

    console.log("Found profile:", profile.id, "username:", profile.username);
    console.log("Current subscription status:", profile.subscriptionStatus);
    console.log("Current plan:", profile.subscriptionPlan);
    console.log("Is OG pricing:", profile.isOgPricing);

    // 4. Determine pricing
    const isOgPricing = profile.isOgPricing === true;
    const pricing = isOgPricing ? OG_PRICING : SUBSCRIPTION_PRICING;
    const price = pricing[plan];
    console.log("Using", isOgPricing ? "OG" : "standard", "pricing. Price:", price, "MTR");

    // 5. Check current subscription status
    const currentStatus = profile.subscriptionStatus || 'none';
    const currentPlan = profile.subscriptionPlan || null;
    const now = new Date();
    
    // Determine if user has an active subscription or trial
    const hasActiveSubscription = currentStatus === 'active' || currentStatus === 'trial';
    const currentExpiresAt = profile.subscriptionExpiresAt || profile.trialEndsAt;
    
    // Note: We allow scheduling even the same plan to extend the subscription
    // The scheduling logic below will handle when to charge

    // 6. Determine when to start the new subscription
    let subscriptionStartsAt: Date;
    let shouldChargeNow: boolean;
    
    if (hasActiveSubscription && currentExpiresAt) {
      // User has active subscription/trial - schedule new subscription to start after current period ends
      subscriptionStartsAt = new Date(currentExpiresAt);
      shouldChargeNow = false;
      console.log("User has active subscription/trial. Scheduling new subscription to start after:", subscriptionStartsAt.toISOString());
    } else {
      // No active subscription - start immediately
      subscriptionStartsAt = now;
      shouldChargeNow = true;
      console.log("No active subscription. Starting immediately.");
    }

    // 7. Get user's credit balance (always check, even if not charging now)
    console.log("Checking user credits...");
    const creditsQuery = await docClient.send(
      new QueryCommand({
        TableName: USER_CREDITS_TABLE,
        IndexName: 'userIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': cognitoId,
        },
        Limit: 1,
      })
    );

    const creditsRecord = creditsQuery.Items?.[0];
    const currentCredits = creditsRecord?.credits || 0;
    console.log("Current credits:", currentCredits, "Required:", price);

    // 8. If charging now, verify sufficient credits
    if (shouldChargeNow) {
      if (currentCredits < price) {
        return {
          statusCode: 402,
          body: JSON.stringify({
            success: false,
            error: `Insufficient credits. You have ${currentCredits} MTR but need ${price} MTR.`,
            currentCredits,
            requiredCredits: price,
          }),
        };
      }

      if (!creditsRecord) {
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: "User credits record not found" }),
        };
      }

      // Deduct credits immediately
      console.log("Deducting credits now...");
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
      console.log("Credits deducted. New balance:", newCredits);

      // Create credit transaction record
      console.log("Creating transaction record...");
      const transactionId = randomUUID();
      await docClient.send(
        new PutCommand({
          TableName: CREDIT_TRANSACTIONS_TABLE,
          Item: {
            id: transactionId,
            userId: cognitoId,
            amount: price,
            transactionType: 'subscription_purchase',
            description: `Pro subscription: ${plan} plan`,
            relatedEntity: profile.id,
            createdAt: now.toISOString(),
          },
        })
      );
    } else {
      console.log("Subscription scheduled. Credits will be charged when subscription starts on:", subscriptionStartsAt.toISOString());
    }

    // 9. Calculate subscription expiration date (from start date)
    let subscriptionExpiresAt: Date;
    if (plan === 'monthly') {
      subscriptionExpiresAt = new Date(subscriptionStartsAt);
      subscriptionExpiresAt.setMonth(subscriptionExpiresAt.getMonth() + 1);
    } else {
      subscriptionExpiresAt = new Date(subscriptionStartsAt);
      subscriptionExpiresAt.setFullYear(subscriptionExpiresAt.getFullYear() + 1);
    }

    console.log("Subscription period:", subscriptionStartsAt.toISOString(), "to", subscriptionExpiresAt.toISOString());

    // 10. Update social profile with subscription
    console.log("Updating profile subscription...");
    
    // Calculate accumulated tenure (for badge calculation)
    const previousTenureMonths = profile.tenureMonthsAccumulated || 0;
    const tenureStartedAt = profile.tenureStartedAt || (shouldChargeNow ? now.toISOString() : subscriptionStartsAt.toISOString());

    if (shouldChargeNow) {
      // Starting subscription immediately - charge already deducted above
      await docClient.send(
        new UpdateCommand({
          TableName: SOCIAL_PROFILE_TABLE,
          Key: { id: profile.id },
          UpdateExpression: `SET 
            subscriptionStatus = :status,
            subscriptionPlan = :plan,
            subscriptionStartedAt = :startedAt,
            subscriptionExpiresAt = :expiresAt,
            tenureStartedAt = :tenureStartedAt,
            tenureMonthsAccumulated = :tenureMonths,
            updatedAt = :updatedAt`,
          ExpressionAttributeValues: {
            ':status': 'active',
            ':plan': plan,
            ':startedAt': now.toISOString(),
            ':expiresAt': subscriptionExpiresAt.toISOString(),
            ':tenureStartedAt': tenureStartedAt,
            ':tenureMonths': previousTenureMonths,
            ':updatedAt': now.toISOString(),
          },
        })
      );
    } else {
      // Scheduling subscription for after current period ends
      // Keep current status and plan, store pending subscription
      // When current period ends, renewal handler will charge and activate
      await docClient.send(
        new UpdateCommand({
          TableName: SOCIAL_PROFILE_TABLE,
          Key: { id: profile.id },
          UpdateExpression: `SET 
            pendingSubscriptionPlan = :pendingPlan,
            pendingSubscriptionStartsAt = :pendingStartsAt,
            subscriptionExpiresAt = :expiresAt,
            updatedAt = :updatedAt`,
          ExpressionAttributeValues: {
            ':pendingPlan': plan,
            ':pendingStartsAt': subscriptionStartsAt.toISOString(),
            ':expiresAt': subscriptionExpiresAt.toISOString(), // Extended from current expiration
            ':updatedAt': now.toISOString(),
          },
        })
      );
    }

    console.log("Profile updated successfully!");
    console.log("=== PURCHASE SUBSCRIPTION LAMBDA SUCCESS ===");

    const message = shouldChargeNow
      ? `Welcome to Pro! Your ${plan} subscription is now active.`
      : `Your ${plan} subscription is scheduled to start on ${subscriptionStartsAt.toLocaleDateString()} (after your current ${currentStatus === 'trial' ? 'trial' : 'subscription'} ends). You will be charged ${price} MTR at that time.`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        plan,
        price,
        newBalance: shouldChargeNow ? (currentCredits - price) : currentCredits,
        subscriptionStartedAt: shouldChargeNow ? now.toISOString() : subscriptionStartsAt.toISOString(),
        subscriptionExpiresAt: subscriptionExpiresAt.toISOString(),
        scheduled: !shouldChargeNow,
        scheduledStartDate: shouldChargeNow ? null : subscriptionStartsAt.toISOString(),
        message,
      }),
    };

  } catch (error) {
    console.error("=== PURCHASE SUBSCRIPTION LAMBDA ERROR ===");
    console.error("Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to process subscription",
        details: errorMessage,
        errorType: errorName,
      }),
    };
  }
};
