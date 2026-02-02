import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';
import { hasRecurringConflict } from '../utils/recurrence';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

// Table names from environment
const ROBOT_RESERVATION_TABLE = process.env.ROBOT_RESERVATION_TABLE!;
const ROBOT_AVAILABILITY_TABLE = process.env.ROBOT_AVAILABILITY_TABLE!;
const ROBOT_TABLE = process.env.ROBOT_TABLE_NAME!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const PLATFORM_SETTINGS_TABLE = process.env.PLATFORM_SETTINGS_TABLE!;
const PARTNER_PAYOUT_TABLE = process.env.PARTNER_PAYOUT_TABLE!;
const PARTNER_TABLE_NAME = process.env.PARTNER_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const MINIMUM_RESERVATION_MINUTES = 15;
const MAX_ADVANCE_BOOKING_DAYS = 30;
const MIN_ADVANCE_BOOKING_HOURS = 1; // Cannot book within the same hour

export const handler: Schema["createRobotReservationLambda"]["functionHandler"] = async (event) => {
  console.log("Create Robot Reservation request:", JSON.stringify(event, null, 2));

  const { robotId, startTime, endTime, durationMinutes } = event.arguments;

  if (!robotId || !startTime || !endTime || !durationMinutes) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required arguments: robotId, startTime, endTime, and durationMinutes are required" }),
    };
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized: must be logged in with Cognito" }),
    };
  }

  const userId = identity.username;

  // Get user email
  let userEmail: string | undefined;
  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      })
    );
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
  } catch (error) {
    console.error("Could not fetch user email from Cognito:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to verify user identity" }),
    };
  }

  try {
    // 1. Validate duration (minimum 15 minutes)
    if (durationMinutes < MINIMUM_RESERVATION_MINUTES) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Reservation duration must be at least ${MINIMUM_RESERVATION_MINUTES} minutes` }),
      };
    }

    // 2. Parse and validate times
    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid date format for startTime or endTime" }),
      };
    }

    if (end <= start) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "endTime must be after startTime" }),
      };
    }

    // 3. Validate booking window (up to 1 month in advance, not within same hour)
    const maxAdvanceDate = new Date(now);
    maxAdvanceDate.setDate(maxAdvanceDate.getDate() + MAX_ADVANCE_BOOKING_DAYS);
    
    if (start > maxAdvanceDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Cannot book more than ${MAX_ADVANCE_BOOKING_DAYS} days in advance` }),
      };
    }

    const minAdvanceDate = new Date(now);
    minAdvanceDate.setHours(minAdvanceDate.getHours() + MIN_ADVANCE_BOOKING_HOURS);
    
    if (start < minAdvanceDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Cannot book within ${MIN_ADVANCE_BOOKING_HOURS} hour(s) of current time` }),
      };
    }

    // 4. Get robot details
    const robotQuery = await docClient.send(
      new QueryCommand({
        TableName: ROBOT_TABLE,
        IndexName: 'robotIdIndex',
        KeyConditionExpression: 'robotId = :robotId',
        ExpressionAttributeValues: {
          ':robotId': robotId,
        },
        Limit: 1,
      })
    );

    const robot = robotQuery.Items?.[0];
    if (!robot || !robot.id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Robot not found: ${robotId}` }),
      };
    }

    const robotUuid = robot.id;
    const partnerTableId = robot.partnerId;
    const hourlyRateCredits = robot.hourlyRateCredits || 100;

    if (!partnerTableId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Robot has no partnerId: ${robotId}` }),
      };
    }

    const partnerResult = await docClient.send(
      new GetCommand({
        TableName: PARTNER_TABLE_NAME,
        Key: { id: partnerTableId },
      })
    );
    const partner = partnerResult.Item;
    const partnerCognitoUsername = partner?.cognitoUsername;
    if (!partnerCognitoUsername) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Partner not found or has no cognitoUsername: ${partnerTableId}` }),
      };
    }

    // 5. Check robot availability (no conflicts with existing reservations or availability blocks)
    const availabilityCheck = await checkAvailability(robotId, start, end);
    if (!availabilityCheck.available) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: availabilityCheck.reason || "Robot is not available during the requested time" }),
      };
    }

    // 6. Get platform markup
    const platformMarkupPercent = await getPlatformMarkup();

    // 7. Calculate costs
    const durationHours = durationMinutes / 60;
    const baseCostCredits = hourlyRateCredits * durationHours;
    const platformFeeCredits = baseCostCredits * (platformMarkupPercent / 100);
    const totalCostCredits = baseCostCredits + platformFeeCredits;
    
    // Deposit is at least 1 minute's cost
    const oneMinuteCost = (hourlyRateCredits / 60) * (1 + platformMarkupPercent / 100);
    const depositCredits = Math.max(oneMinuteCost, totalCostCredits * 0.1); // At least 1 minute or 10% of total

    // 8. Check user has sufficient credits for deposit
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
    const userCredits = userCreditsRecord?.credits || 0;
    if (userCredits < depositCredits) {
      return {
        statusCode: 402,
        body: JSON.stringify({ 
          error: "Insufficient credits for deposit",
          requiredCredits: depositCredits,
          currentCredits: userCredits,
        }),
      };
    }

    // 9. Create reservation
    const reservationId = randomUUID();
    const nowISO = new Date().toISOString();

    await docClient.send(
      new PutCommand({
        TableName: ROBOT_RESERVATION_TABLE,
        Item: {
          id: reservationId,
          robotId,
          robotUuid,
          userId,
          userEmail: userEmail || null,
          partnerId: partnerTableId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          durationMinutes,
          status: 'confirmed', // Confirmed after deposit is paid
          depositCredits,
          totalCostCredits,
          hourlyRateCredits,
          platformMarkupPercent,
          refundedCredits: 0,
          reminderSent: false,
          createdAt: nowISO,
          updatedAt: nowISO,
        },
      })
    );

    // 9b. Calculate partner earnings from deposit
    // Deposit calculation: max(1 minute cost, 10% of total cost)
    // Partner gets their share of the deposit (after platform markup)
    const depositBaseCost = depositCredits / (1 + platformMarkupPercent / 100); // Reverse calculate base cost
    const depositPlatformFee = depositCredits - depositBaseCost;
    const depositPartnerEarnings = depositBaseCost;

    // 9c. Create PartnerPayout record for the deposit (use Cognito username so partner sees it on My Robots)
    let partnerEmail: string | undefined;
    try {
      const partnerUser = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: partnerCognitoUsername,
        })
      );
      partnerEmail = partnerUser.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    } catch (e) {
      console.warn('Could not fetch partner email from Cognito for payout:', e);
    }

    const payoutId = randomUUID();
    await docClient.send(
      new PutCommand({
        TableName: PARTNER_PAYOUT_TABLE,
        Item: {
          id: payoutId,
          owner: partnerCognitoUsername,
          partnerId: partnerCognitoUsername,
          partnerEmail: partnerEmail ?? undefined,
          reservationId, // Link to reservation
          robotId,
          robotName: robot.name || robotId,
          creditsEarned: Math.round(depositPartnerEarnings),
          platformFee: Math.round(depositPlatformFee),
          totalCreditsCharged: Math.round(depositCredits),
          durationMinutes, // Reservation duration
          status: 'pending', // Payouts are pending until manually processed by admin
          createdAt: nowISO,
        },
      })
    );

    // 10. Deduct deposit from user credits
    if (userCreditsRecord) {
      // User has existing record, update it
      await docClient.send(
        new UpdateCommand({
          TableName: USER_CREDITS_TABLE,
          Key: { id: userCreditsRecord.id },
          UpdateExpression: 'SET credits = credits - :deposit, lastUpdated = :now',
          ExpressionAttributeValues: {
            ':deposit': depositCredits,
            ':now': nowISO,
          },
          ConditionExpression: 'credits >= :deposit', // Ensure sufficient credits
        })
      );
    } else {
      // User doesn't have a record yet, but we already checked they have credits
      // This shouldn't happen, but handle it gracefully
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "User credits record not found" }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        reservationId,
        message: "Reservation created successfully",
        depositCredits,
        totalCostCredits,
      }),
    };
  } catch (error) {
    console.error("Error creating reservation:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to create reservation",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};


async function checkAvailability(robotId: string, start: Date, end: Date): Promise<{ available: boolean; reason?: string }> {
  const reservationsQuery = await docClient.send(
    new QueryCommand({
      TableName: ROBOT_RESERVATION_TABLE,
      IndexName: 'robotIdIndex',
      KeyConditionExpression: 'robotId = :robotId',
      FilterExpression: '#status IN (:pending, :confirmed, :active) AND ((startTime <= :start AND endTime > :start) OR (startTime < :end AND endTime >= :end) OR (startTime >= :start AND endTime <= :end))',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':robotId': robotId,
        ':start': start.toISOString(),
        ':end': end.toISOString(),
        ':pending': 'pending',
        ':confirmed': 'confirmed',
        ':active': 'active',
      },
    })
  );

  if (reservationsQuery.Items && reservationsQuery.Items.length > 0) {
    return { available: false, reason: "Robot is already reserved during this time" };
  }

  const availabilityQuery = await docClient.send(
    new QueryCommand({
      TableName: ROBOT_AVAILABILITY_TABLE,
      IndexName: 'robotIdIndex',
      KeyConditionExpression: 'robotId = :robotId',
      FilterExpression: '(attribute_not_exists(isRecurring) OR isRecurring = :false) AND ((startTime <= :start AND endTime > :start) OR (startTime < :end AND endTime >= :end) OR (startTime >= :start AND endTime <= :end))',
      ExpressionAttributeValues: {
        ':robotId': robotId,
        ':start': start.toISOString(),
        ':end': end.toISOString(),
        ':false': false,
      },
    })
  );

  if (availabilityQuery.Items && availabilityQuery.Items.length > 0) {
    return { available: false, reason: "Robot is blocked during this time by the partner" };
  }

  const recurringQuery = await docClient.send(
    new QueryCommand({
      TableName: ROBOT_AVAILABILITY_TABLE,
      IndexName: 'robotIdIndex',
      KeyConditionExpression: 'robotId = :robotId',
      FilterExpression: 'isRecurring = :true',
      ExpressionAttributeValues: {
        ':robotId': robotId,
        ':true': true,
      },
    })
  );

  if (recurringQuery.Items && recurringQuery.Items.length > 0) {
    const recurringBlocks = recurringQuery.Items.filter(
      (block): block is { startTime: string; endTime: string; recurrencePattern?: string } =>
        typeof block?.startTime === 'string' && typeof block?.endTime === 'string'
    );
    if (hasRecurringConflict(recurringBlocks, start, end)) {
      return { available: false, reason: "Robot is blocked during this time by the partner (recurring schedule)" };
    }
  }

  return { available: true };
}

async function getPlatformMarkup(): Promise<number> {
  try {
    const settingsQuery = await docClient.send(
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

    if (settingsQuery.Items && settingsQuery.Items.length > 0) {
      return parseFloat(settingsQuery.Items[0].settingValue || '30');
    }
  } catch (error) {
    console.warn("Failed to fetch platform markup, using default:", error);
  }

  return 30; // Default 30%
}

