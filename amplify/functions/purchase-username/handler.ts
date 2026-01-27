import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Table names from environment
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const SOCIAL_PROFILE_TABLE = process.env.SOCIAL_PROFILE_TABLE!;
const RESERVED_USERNAME_TABLE = process.env.RESERVED_USERNAME_TABLE!;
const PROMO_CODE_TABLE = process.env.PROMO_CODE_TABLE!;
const PROMO_CODE_REDEMPTION_TABLE = process.env.PROMO_CODE_REDEMPTION_TABLE!;

// Username tier pricing (in MTR credits)
// Conversion: 1 USD = 100 MTR
const USERNAME_TIERS = {
  og: { minLength: 1, maxLength: 3, price: 7900, label: 'OG' },
  premium: { minLength: 4, maxLength: 5, price: 1900, label: 'Premium' },
  standard: { minLength: 6, maxLength: 20, price: 500, label: 'Standard' },
};

// Reserved system usernames
const SYSTEM_RESERVED = [
  'admin', 'administrator', 'support', 'help', 'modulr', 'modulrcloud',
  'official', 'verified', 'system', 'bot', 'robot', 'api', 'dev', 'developer',
  'null', 'undefined', 'test', 'demo', 'example', 'root', 'superuser',
  'about', 'home', 'settings', 'profile', 'login', 'logout', 'signup',
  'register', 'dashboard', 'explore', 'search', 'notifications', 'messages',
];

// Basic profanity filter
const PROFANITY_LIST = [
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap',
];

function getTierForLength(length: number): keyof typeof USERNAME_TIERS | null {
  if (length >= USERNAME_TIERS.og.minLength && length <= USERNAME_TIERS.og.maxLength) return 'og';
  if (length >= USERNAME_TIERS.premium.minLength && length <= USERNAME_TIERS.premium.maxLength) return 'premium';
  if (length >= USERNAME_TIERS.standard.minLength && length <= USERNAME_TIERS.standard.maxLength) return 'standard';
  return null;
}

function validateUsernameFormat(username: string): { valid: boolean; error?: string } {
  if (!username || username.length === 0) {
    return { valid: false, error: 'Username is required' };
  }

  if (username.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }

  if (!/^[a-z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Only lowercase letters, numbers, and underscores allowed' };
  }

  if (/__/.test(username)) {
    return { valid: false, error: 'No consecutive underscores allowed' };
  }

  if (username.startsWith('_') || username.endsWith('_')) {
    return { valid: false, error: 'Cannot start or end with underscore' };
  }

  if (SYSTEM_RESERVED.includes(username)) {
    return { valid: false, error: 'This username is reserved' };
  }

  for (const word of PROFANITY_LIST) {
    if (username.includes(word)) {
      return { valid: false, error: 'Username contains inappropriate content' };
    }
  }

  return { valid: true };
}

export const handler: Schema["purchaseUsernameLambda"]["functionHandler"] = async (event) => {
  console.log("=== PURCHASE USERNAME LAMBDA START ===");
  console.log("Full event:", JSON.stringify(event, null, 2));
  console.log("Event arguments:", JSON.stringify(event.arguments, null, 2));
  console.log("Event identity:", JSON.stringify(event.identity, null, 2));
  
  // Log environment variables (without sensitive data)
  console.log("Environment - USER_CREDITS_TABLE:", USER_CREDITS_TABLE);
  console.log("Environment - CREDIT_TRANSACTIONS_TABLE:", CREDIT_TRANSACTIONS_TABLE);
  console.log("Environment - SOCIAL_PROFILE_TABLE:", SOCIAL_PROFILE_TABLE);
  console.log("Environment - RESERVED_USERNAME_TABLE:", RESERVED_USERNAME_TABLE);
  
  const { username, promoCode } = event.arguments;

  if (!username) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Username is required" }),
    };
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ success: false, error: "Unauthorized: must be logged in" }),
    };
  }

  const cognitoId = identity.username;
  const userEmail = "email" in identity ? identity.email : undefined;

  // Normalize username
  const normalizedUsername = username.toLowerCase().trim();

  // 1. Validate username format
  const formatValidation = validateUsernameFormat(normalizedUsername);
  if (!formatValidation.valid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: formatValidation.error }),
    };
  }

  // 2. Get tier and price
  const tier = getTierForLength(normalizedUsername.length);
  if (!tier) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Invalid username length" }),
    };
  }

  const basePrice = USERNAME_TIERS[tier].price;

  // Validate and apply promo code if provided
  let finalPrice = basePrice;
  let discountPercent = 0;
  let bonusTrialMonths = 0;
  let promoCodeRecord: any = null;
  let promoCodeId: string | null = null;

  if (promoCode && promoCode.trim().length > 0) {
    const normalizedPromoCode = promoCode.trim().toUpperCase();
    console.log("Validating promo code:", normalizedPromoCode);

    try {
      // Query for promo code
      const promoQuery = await docClient.send(
        new QueryCommand({
          TableName: PROMO_CODE_TABLE,
          IndexName: 'codeIndex',
          KeyConditionExpression: 'code = :code',
          ExpressionAttributeValues: {
            ':code': normalizedPromoCode,
          },
          Limit: 1,
        })
      );

      promoCodeRecord = promoQuery.Items?.[0];

      if (!promoCodeRecord) {
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: "Promo code not found" }),
        };
      }

      // Validate promo code
      const now = new Date();
      
      if (promoCodeRecord.isActive === false) {
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: "Promo code is no longer active" }),
        };
      }

      if (promoCodeRecord.startsAt) {
        const startsAt = new Date(promoCodeRecord.startsAt);
        if (now < startsAt) {
          return {
            statusCode: 400,
            body: JSON.stringify({ success: false, error: "Promo code is not yet active" }),
          };
        }
      }

      if (promoCodeRecord.expiresAt) {
        const expiresAt = new Date(promoCodeRecord.expiresAt);
        if (now > expiresAt) {
          return {
            statusCode: 400,
            body: JSON.stringify({ success: false, error: "Promo code has expired" }),
          };
        }
      }

      if (promoCodeRecord.maxUses && typeof promoCodeRecord.maxUses === 'number') {
        const usedCount = promoCodeRecord.usedCount || 0;
        if (usedCount >= promoCodeRecord.maxUses) {
          return {
            statusCode: 400,
            body: JSON.stringify({ success: false, error: "Promo code has reached maximum uses" }),
          };
        }
      }

      // Promo code is valid - apply discounts
      promoCodeId = promoCodeRecord.id;
      discountPercent = promoCodeRecord.usernameDiscountPercent || 0;
      bonusTrialMonths = promoCodeRecord.trialMonths || 0;
      
      if (discountPercent > 0) {
        const discountAmount = Math.floor(basePrice * (discountPercent / 100));
        finalPrice = basePrice - discountAmount;
        console.log(`Promo code applied: ${discountPercent}% off. Base: ${basePrice}, Final: ${finalPrice}`);
      }

      if (bonusTrialMonths > 0) {
        console.log(`Promo code grants ${bonusTrialMonths} bonus trial months`);
      }

    } catch (promoError) {
      console.error("Error validating promo code:", promoError);
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: "Failed to validate promo code" }),
      };
    }
  }

  const price = finalPrice; // Use final price (after discount) for rest of logic

  try {
    // 3. Check if user already has a username
    console.log("Step 3: Checking if user already has username...");
    console.log("Querying SOCIAL_PROFILE_TABLE:", SOCIAL_PROFILE_TABLE, "with cognitoId:", cognitoId);
    
    const existingProfileQuery = await docClient.send(
      new QueryCommand({
        TableName: SOCIAL_PROFILE_TABLE,
        IndexName: 'cognitoIdIndex',  // Matches schema secondaryIndex name
        KeyConditionExpression: 'cognitoId = :cognitoId',
        ExpressionAttributeValues: {
          ':cognitoId': cognitoId,
        },
        Limit: 1,
      })
    );
    console.log("Existing profile query result:", JSON.stringify(existingProfileQuery, null, 2));

    if (existingProfileQuery.Items && existingProfileQuery.Items.length > 0) {
      const existingProfile = existingProfileQuery.Items[0];
      
      // REPAIR: Add missing owner and __typename fields for Amplify Data compatibility
      // This fixes profiles created before these fields were added
      if (!existingProfile.owner || !existingProfile.__typename) {
        console.log("Repairing profile - adding missing owner/__typename fields...");
        await docClient.send(
          new UpdateCommand({
            TableName: SOCIAL_PROFILE_TABLE,
            Key: { id: existingProfile.id },
            UpdateExpression: 'SET #owner = :owner, #typename = :typename',
            ExpressionAttributeNames: {
              '#owner': 'owner',
              '#typename': '__typename',
            },
            ExpressionAttributeValues: {
              ':owner': cognitoId,
              ':typename': 'SocialProfile',
            },
          })
        );
        console.log("Profile repaired successfully");
      }
      
      if (existingProfile.username) {
        console.log("User already has username:", existingProfile.username);
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            error: `You already have a username: @${existingProfile.username}`,
            profileRepaired: !existingProfile.owner || !existingProfile.__typename,  // Tell frontend if repair happened
          }),
        };
      }
    }

    // 4. Check if username is taken in SocialProfile
    console.log("Step 4: Checking if username is taken...");
    const takenQuery = await docClient.send(
      new QueryCommand({
        TableName: SOCIAL_PROFILE_TABLE,
        IndexName: 'usernameIndex',  // Matches schema secondaryIndex name
        KeyConditionExpression: 'username = :username',
        ExpressionAttributeValues: {
          ':username': normalizedUsername,
        },
        Limit: 1,
      })
    );
    console.log("Username taken query result:", JSON.stringify(takenQuery, null, 2));

    if (takenQuery.Items && takenQuery.Items.length > 0) {
      console.log("Username is already taken");
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "This username is already taken" }),
      };
    }

    // 5. Check if username is reserved
    console.log("Step 5: Checking if username is reserved...");
    const reservedQuery = await docClient.send(
      new QueryCommand({
        TableName: RESERVED_USERNAME_TABLE,
        IndexName: 'usernameIndex',  // Matches schema secondaryIndex name
        KeyConditionExpression: 'username = :username',
        ExpressionAttributeValues: {
          ':username': normalizedUsername,
        },
        Limit: 1,
      })
    );
    console.log("Reserved username query result:", JSON.stringify(reservedQuery, null, 2));

    if (reservedQuery.Items && reservedQuery.Items.length > 0) {
      const reserved = reservedQuery.Items[0];
      if (reserved.contactRequired) {
        console.log("Username is reserved with contact required");
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            error: "This username is reserved. Contact support@modulr.cloud to claim it." 
          }),
        };
      }
      console.log("Username is reserved");
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "This username is reserved" }),
      };
    }

    // 6. Check user's credit balance
    console.log("Step 6: Checking user credit balance...");
    console.log("Querying USER_CREDITS_TABLE:", USER_CREDITS_TABLE, "with userId:", cognitoId);
    
    const userCreditsQuery = await docClient.send(
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
    console.log("User credits query result:", JSON.stringify(userCreditsQuery, null, 2));

    const userCreditsRecord = userCreditsQuery.Items?.[0];
    const currentCredits = userCreditsRecord?.credits || 0;
    console.log("User credits record:", JSON.stringify(userCreditsRecord, null, 2));
    console.log("Current credits:", currentCredits, "Required:", price);

    if (currentCredits < price) {
      console.log("Insufficient credits");
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

    // 7. Deduct credits
    console.log("Step 7: Deducting credits...");
    const newCredits = currentCredits - price;
    const now = new Date().toISOString();

    if (userCreditsRecord) {
      console.log("Updating credits from", currentCredits, "to", newCredits);
      await docClient.send(
        new UpdateCommand({
          TableName: USER_CREDITS_TABLE,
          Key: { id: userCreditsRecord.id },
          UpdateExpression: 'SET credits = :credits, lastUpdated = :now',
          ExpressionAttributeValues: {
            ':credits': newCredits,
            ':now': now,
          },
        })
      );
      console.log("Credits deducted successfully");
    } else {
      console.log("User credits record not found");
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "User credits record not found" }),
      };
    }

    // 8. Create credit transaction record
    console.log("Step 8: Creating credit transaction record...");
    const transactionId = randomUUID();
    await docClient.send(
      new PutCommand({
        TableName: CREDIT_TRANSACTIONS_TABLE,
        Item: {
          id: transactionId,
          userId: cognitoId,
          amount: price,
          transactionType: 'username_purchase',
          description: `Username registration: @${normalizedUsername} (${tier} tier)`,
          createdAt: now,
        },
      })
    );
    console.log("Credit transaction created with id:", transactionId);

    // 9. Create or update SocialProfile
    console.log("Step 9: Creating/updating SocialProfile...");
    const profileId = existingProfileQuery.Items?.[0]?.id || randomUUID();
    
    // Calculate trial end date: 90 days (3 months) base + bonus months from promo code
    const baseTrialDays = 90;
    const bonusTrialDays = bonusTrialMonths * 30;
    const totalTrialDays = baseTrialDays + bonusTrialDays;
    const trialEndsAt = new Date(Date.now() + totalTrialDays * 24 * 60 * 60 * 1000).toISOString();
    console.log("Profile ID:", profileId, "Trial ends at:", trialEndsAt, `(${totalTrialDays} days total)`);

    if (existingProfileQuery.Items && existingProfileQuery.Items.length > 0) {
      // Update existing profile
      // Also add owner and __typename if missing (for Amplify Data compatibility)
      console.log("Updating existing profile...");
      await docClient.send(
        new UpdateCommand({
          TableName: SOCIAL_PROFILE_TABLE,
          Key: { id: profileId },
          UpdateExpression: `SET 
            #owner = :owner,
            #typename = :typename,
            username = :username,
            usernameRegisteredAt = :now,
            usernameTier = :tier,
            usernamePriceMtr = :price,
            subscriptionStatus = :subStatus,
            trialEndsAt = :trialEnds,
            isOgPricing = :ogPricing,
            ogPriceMtrMonthly = :ogMonthly,
            ogPriceMtrAnnual = :ogAnnual,
            updatedAt = :now
          `,
          ExpressionAttributeNames: {
            '#owner': 'owner',           // Reserved word in DynamoDB
            '#typename': '__typename',   // Special field
          },
          ExpressionAttributeValues: {
            ':owner': cognitoId,
            ':typename': 'SocialProfile',
            ':username': normalizedUsername,
            ':now': now,
            ':tier': tier,
            ':price': price,
            ':subStatus': 'trial',
            ':trialEnds': trialEndsAt,
            ':ogPricing': true,
            ':ogMonthly': 399,
            ':ogAnnual': 4000,
          },
        })
      );
      console.log("Profile updated successfully");
    } else {
      // Create new profile
      // IMPORTANT: Include 'owner' and '__typename' fields for Amplify Data compatibility
      // Without these, Amplify Data client queries may not return the record
      console.log("Creating new profile...");
      await docClient.send(
        new PutCommand({
          TableName: SOCIAL_PROFILE_TABLE,
          Item: {
            id: profileId,
            __typename: 'SocialProfile',  // Required for Amplify Data GraphQL
            owner: cognitoId,              // Required for Amplify Data owner-based auth
            cognitoId: cognitoId,
            email: userEmail,
            username: normalizedUsername,
            usernameRegisteredAt: now,
            usernameTier: tier,
            usernamePriceMtr: price,
            role: 'user',
            subscriptionStatus: 'trial',
            trialEndsAt: trialEndsAt,
            moderationStatus: 'active',
            tenureBadge: 'none',
            tenureMonthsAccumulated: 0,
            isOgPricing: true,
            ogPriceMtrMonthly: 399,
            ogPriceMtrAnnual: 4000,
            createdAt: now,
            updatedAt: now,
          },
        })
      );
      console.log("Profile created successfully");
    }

    // 10. Record promo code redemption if promo code was used
    if (promoCodeId && promoCodeRecord) {
      console.log("Step 10: Recording promo code redemption...");
      try {
        const redemptionId = randomUUID();
        const discountAmountUsd = discountPercent > 0 ? (basePrice - price) / 100 : 0; // Convert MTR to USD (1 USD = 100 MTR)
        
        // Create redemption record
        await docClient.send(
          new PutCommand({
            TableName: PROMO_CODE_REDEMPTION_TABLE,
            Item: {
              id: redemptionId,
              __typename: 'PromoCodeRedemption',
              codeId: promoCodeId,
              userId: cognitoId,
              usernameRegistered: normalizedUsername,
              discountApplied: discountAmountUsd,
              trialMonthsGranted: bonusTrialMonths,
              redeemedAt: now,
            },
          })
        );
        console.log("Promo code redemption recorded:", redemptionId);

        // Update promo code usedCount
        const newUsedCount = (promoCodeRecord.usedCount || 0) + 1;
        await docClient.send(
          new UpdateCommand({
            TableName: PROMO_CODE_TABLE,
            Key: { id: promoCodeId },
            UpdateExpression: 'SET usedCount = :count, updatedAt = :now',
            ExpressionAttributeValues: {
              ':count': newUsedCount,
              ':now': now,
            },
          })
        );
        console.log("Promo code usedCount updated to:", newUsedCount);
      } catch (redemptionError) {
        console.error("Error recording promo code redemption (non-fatal):", redemptionError);
        // Don't fail the purchase if redemption tracking fails
      }
    }

    // Calculate trial message
    const totalTrialMonths = 3 + bonusTrialMonths;
    const trialMessage = totalTrialMonths > 3
      ? `Welcome @${normalizedUsername}! You have ${totalTrialMonths} months of Pro access (3 months base + ${bonusTrialMonths} bonus from promo code).`
      : `Welcome @${normalizedUsername}! You have 3 months of Pro access as an early adopter.`;

    console.log("Successfully purchased username:", {
      cognitoId,
      username: normalizedUsername,
      tier,
      basePrice,
      finalPrice: price,
      discountPercent,
      bonusTrialMonths,
      newCredits,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        username: normalizedUsername,
        tier,
        price,
        basePrice: discountPercent > 0 ? basePrice : undefined, // Only include if discount was applied
        discountPercent: discountPercent > 0 ? discountPercent : undefined,
        newBalance: newCredits,
        trialEndsAt,
        trialMonths: totalTrialMonths,
        message: trialMessage,
      }),
    };

  } catch (error) {
    // Enhanced error logging
    console.error("Error purchasing username - Full error:", error);
    console.error("Error type:", typeof error);
    console.error("Error constructor:", error?.constructor?.name);
    
    let errorMessage = "Unknown error";
    let errorDetails = {};
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (typeof error === 'object' && error !== null) {
      errorMessage = JSON.stringify(error);
      errorDetails = error;
    } else {
      errorMessage = String(error);
    }
    
    console.error("Parsed error message:", errorMessage);
    console.error("Error details:", JSON.stringify(errorDetails, null, 2));
    
    // Check for specific DynamoDB errors
    if (error && typeof error === 'object' && 'name' in error) {
      const awsError = error as { name: string; message?: string; $metadata?: unknown };
      console.error("AWS Error name:", awsError.name);
      console.error("AWS Error message:", awsError.message);
      console.error("AWS Error metadata:", JSON.stringify(awsError.$metadata, null, 2));
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to purchase username",
        details: errorMessage,
        errorType: error?.constructor?.name || typeof error,
      }),
    };
  }
};
