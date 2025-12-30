import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Table names from environment (set in backend.ts)
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE!;
const PARTNER_PAYOUT_TABLE = process.env.PARTNER_PAYOUT_TABLE!;

// Default platform markup (30%) if not set in PlatformSettings
const DEFAULT_PLATFORM_MARKUP_PERCENT = 30;

export const handler: Schema["processSessionPaymentLambda"]["functionHandler"] = async (event) => {
  console.log("Process Session Payment request:", JSON.stringify(event, null, 2));
  
  const { sessionId } = event.arguments;

  if (!sessionId) {
    throw new Error("Missing required argument: sessionId");
  }

  const identity = event.identity;
  if (!identity) {
    throw new Error("Unauthorized: must be logged in");
  }

  try {
    // 1. Get the session
    const sessionResult = await docClient.send(
      new GetCommand({
        TableName: SESSION_TABLE_NAME,
        Key: { id: sessionId },
      })
    );

    const session = sessionResult.Item;
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Check if payment already processed (session has creditsCharged)
    if (session.creditsCharged) {
      console.log("Payment already processed for session:", sessionId);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Payment already processed",
          sessionId,
          creditsCharged: session.creditsCharged,
        }),
      };
    }

    const userId = session.userId;
    const robotId = session.robotId;
    const durationSeconds = session.durationSeconds || 0;
    const partnerId = session.partnerId;

    // Verify user owns this session (or is admin)
    const isAdmin = "groups" in identity && identity.groups?.includes("ADMINS");
    const isOwner = "username" in identity && identity.username === userId;

    if (!isAdmin && !isOwner) {
      throw new Error("Unauthorized: can only process payment for your own sessions");
    }

    // 2. Get the robot and its hourly rate
    const robotResult = await docClient.send(
      new QueryCommand({
        TableName: ROBOT_TABLE_NAME,
        IndexName: 'robotIdIndex',
        KeyConditionExpression: 'robotId = :robotId',
        ExpressionAttributeValues: {
          ':robotId': robotId,
        },
        Limit: 1,
      })
    );

    const robot = robotResult.Items?.[0];
    if (!robot) {
      throw new Error(`Robot not found: ${robotId}`);
    }

    const hourlyRateCredits = robot.hourlyRateCredits || 100; // Default 100 credits/hour

    // 3. Get platform markup percentage
    let platformMarkupPercent = DEFAULT_PLATFORM_MARKUP_PERCENT;
    try {
      const settingsResult = await docClient.send(
        new QueryCommand({
          TableName: PLATFORM_SETTINGS_TABLE,
          IndexName: 'settingKeyIndex',
          KeyConditionExpression: 'settingKey = :key',
          ExpressionAttributeValues: {
            ':key': 'platformMarkupPercent',
          },
          Limit: 1,
        })
      );

      if (settingsResult.Items?.[0]) {
        const settingValue = settingsResult.Items[0].settingValue;
        platformMarkupPercent = parseFloat(settingValue) || DEFAULT_PLATFORM_MARKUP_PERCENT;
      }
    } catch (err) {
      console.warn("Failed to fetch platform markup, using default:", err);
    }

    // 4. Calculate costs
    // Duration in hours
    const durationHours = durationSeconds / 3600;
    // Base cost (what partner charges)
    const baseCostCredits = hourlyRateCredits * durationHours;
    // Platform markup
    const platformFeeCredits = baseCostCredits * (platformMarkupPercent / 100);
    // Total charged to user (base + markup)
    const totalCreditsCharged = baseCostCredits + platformFeeCredits;
    // Partner earnings (base cost only, after markup)
    const partnerEarningsCredits = baseCostCredits;

    console.log("Cost calculation:", {
      durationSeconds,
      durationHours,
      hourlyRateCredits,
      baseCostCredits,
      platformMarkupPercent,
      platformFeeCredits,
      totalCreditsCharged,
      partnerEarningsCredits,
    });

    // 5. Deduct credits from user
    const userCreditsQuery = await docClient.send(
      new QueryCommand({
        TableName: USER_CREDITS_TABLE,
        IndexName: 'userIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Limit: 1,
      })
    );

    const userCreditsRecord = userCreditsQuery.Items?.[0];
    const currentCredits = userCreditsRecord?.credits || 0;

    if (currentCredits < totalCreditsCharged) {
      throw new Error(`Insufficient credits: have ${currentCredits}, need ${totalCreditsCharged}`);
    }

    const newCredits = currentCredits - totalCreditsCharged;

    if (userCreditsRecord) {
      await docClient.send(
        new UpdateCommand({
          TableName: USER_CREDITS_TABLE,
          Key: { id: userCreditsRecord.id },
          UpdateExpression: 'SET credits = :credits, lastUpdated = :now',
          ExpressionAttributeValues: {
            ':credits': newCredits,
            ':now': new Date().toISOString(),
          },
        })
      );
    } else {
      throw new Error("User credits record not found");
    }

    // 6. Create credit transaction record (deduction)
    const transactionId = randomUUID();
    await docClient.send(
      new PutCommand({
        TableName: CREDIT_TRANSACTIONS_TABLE,
        Item: {
          id: transactionId,
          userId,
          amount: -Math.round(totalCreditsCharged), // Negative for deduction
          transactionType: 'deduction',
          description: `Session: ${session.robotName || robotId} (${Math.round(durationHours * 100) / 100}h)`,
          createdAt: new Date().toISOString(),
        },
      })
    );

    // 7. Create PartnerPayout record
    const payoutId = randomUUID();
    await docClient.send(
      new PutCommand({
        TableName: PARTNER_PAYOUT_TABLE,
        Item: {
          id: payoutId,
          owner: partnerId, // For owner-based authorization
          partnerId,
          partnerEmail: session.partnerId, // TODO: Get partner email from Partner table
          sessionId,
          robotId,
          robotName: session.robotName || robotId,
          creditsEarned: Math.round(partnerEarningsCredits),
          platformFee: Math.round(platformFeeCredits),
          totalCreditsCharged: Math.round(totalCreditsCharged),
          durationSeconds,
          status: 'pending', // Payouts are pending until manually processed by admin
          createdAt: new Date().toISOString(),
        },
      })
    );

    // 8. Update Session with cost information
    await docClient.send(
      new UpdateCommand({
        TableName: SESSION_TABLE_NAME,
        Key: { id: sessionId },
        UpdateExpression: 'SET creditsCharged = :creditsCharged, partnerEarnings = :partnerEarnings, platformFee = :platformFee, hourlyRateCredits = :hourlyRate',
        ExpressionAttributeValues: {
          ':creditsCharged': Math.round(totalCreditsCharged),
          ':partnerEarnings': Math.round(partnerEarningsCredits),
          ':platformFee': Math.round(platformFeeCredits),
          ':hourlyRate': hourlyRateCredits,
        },
      })
    );

    console.log("Successfully processed session payment:", {
      sessionId,
      userId,
      creditsCharged: totalCreditsCharged,
      partnerEarnings: partnerEarningsCredits,
      platformFee: platformFeeCredits,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        sessionId,
        creditsCharged: Math.round(totalCreditsCharged),
        partnerEarnings: Math.round(partnerEarningsCredits),
        platformFee: Math.round(platformFeeCredits),
        newBalance: newCredits,
      }),
    };
  } catch (error) {
    console.error("Error processing session payment:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

