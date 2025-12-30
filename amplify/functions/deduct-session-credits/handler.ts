import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Table names from environment
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const CREDIT_TRANSACTIONS_TABLE = process.env.CREDIT_TRANSACTIONS_TABLE!;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME!;
const ROBOT_TABLE_NAME = process.env.ROBOT_TABLE_NAME!;
const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE!;

// Default platform markup (30%) if not set
const DEFAULT_PLATFORM_MARKUP_PERCENT = 30;

export const handler: Schema["deductSessionCreditsLambda"]["functionHandler"] = async (event) => {
  console.log("Deduct Session Credits request:", JSON.stringify(event, null, 2));
  
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

    // Check if session is still active
    if (session.status !== 'active') {
      console.log(`Session ${sessionId} is not active (status: ${session.status}), skipping deduction`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Session is not active, skipping deduction",
          sessionId,
        }),
      };
    }

    const userId = session.userId;
    const robotId = session.robotId;
    const startedAt = session.startedAt;
    const creditsDeductedSoFar = session.creditsDeductedSoFar || 0;

    // Verify user owns this session (or is admin)
    const isAdmin = "groups" in identity && identity.groups?.includes("ADMINS");
    const isOwner = "username" in identity && identity.username === userId;

    if (!isAdmin && !isOwner) {
      throw new Error("Unauthorized: can only deduct credits for your own sessions");
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
      if (settingsResult.Items && settingsResult.Items.length > 0) {
        platformMarkupPercent = parseFloat(settingsResult.Items[0].settingValue || String(DEFAULT_PLATFORM_MARKUP_PERCENT));
      }
    } catch (err) {
      console.warn("Failed to get platform markup, using default:", err);
    }

    // 4. Calculate cost for 1 minute (60 seconds)
    const durationMinutes = 1;
    const durationHours = durationMinutes / 60;
    const baseCostCredits = hourlyRateCredits * durationHours;
    const platformFeeCredits = baseCostCredits * (platformMarkupPercent / 100);
    const totalCreditsForMinute = baseCostCredits + platformFeeCredits;

    console.log("Per-minute cost calculation:", {
      hourlyRateCredits,
      durationMinutes,
      baseCostCredits,
      platformMarkupPercent,
      platformFeeCredits,
      totalCreditsForMinute,
    });

    // 5. Check user's current balance
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

    // Check if user has enough credits for this minute
    if (currentCredits < totalCreditsForMinute) {
      // Update session status to indicate insufficient funds
      await docClient.send(
        new UpdateCommand({
          TableName: SESSION_TABLE_NAME,
          Key: { id: sessionId },
          UpdateExpression: 'SET #status = :status, updatedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'insufficient_funds',
            ':now': new Date().toISOString(),
          },
        })
      );

      return {
        statusCode: 402, // Payment Required
        body: JSON.stringify({
          success: false,
          error: "Insufficient credits",
          message: `Insufficient credits: have ${currentCredits}, need ${totalCreditsForMinute} for this minute`,
          currentCredits,
          requiredCredits: totalCreditsForMinute,
          sessionId,
        }),
      };
    }

    // 6. Deduct credits from user
    const newCredits = currentCredits - totalCreditsForMinute;

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

    // 7. Create credit transaction record (deduction)
    const transactionId = randomUUID();
    await docClient.send(
      new PutCommand({
        TableName: CREDIT_TRANSACTIONS_TABLE,
        Item: {
          id: transactionId,
          userId,
          credits: -totalCreditsForMinute, // Negative for deduction
          transactionType: 'session_usage',
          description: `Session usage: ${robotId} (1 minute)`,
          sessionId,
          timestamp: new Date().toISOString(),
        },
      })
    );

    // 8. Update session with cumulative credits deducted
    const newCreditsDeductedSoFar = creditsDeductedSoFar + totalCreditsForMinute;
    await docClient.send(
      new UpdateCommand({
        TableName: SESSION_TABLE_NAME,
        Key: { id: sessionId },
        UpdateExpression: 'SET creditsDeductedSoFar = :credits, lastDeductionAt = :now, updatedAt = :now',
        ExpressionAttributeValues: {
          ':credits': newCreditsDeductedSoFar,
          ':now': new Date().toISOString(),
        },
      })
    );

    console.log("Successfully deducted credits for session:", {
      sessionId,
      creditsDeducted: totalCreditsForMinute,
      totalDeductedSoFar: newCreditsDeductedSoFar,
      remainingCredits: newCredits,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Credits deducted successfully",
        sessionId,
        creditsDeducted: totalCreditsForMinute,
        totalDeductedSoFar: newCreditsDeductedSoFar,
        remainingCredits: newCredits,
      }),
    };
  } catch (error) {
    console.error("Error deducting session credits:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to deduct session credits",
        details: errorMessage,
      }),
    };
  }
};

