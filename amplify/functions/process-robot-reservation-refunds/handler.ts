import type { Schema } from "../../data/resource";
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const ROBOT_RESERVATION_TABLE = process.env.ROBOT_RESERVATION_TABLE!;
const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

/**
 * Processes refunds for reservations where the robot was offline during the scheduled time.
 * This function should be called periodically (e.g., every 15 minutes) or manually by admins.
 * 
 * It checks:
 * 1. Reservations that are currently active (startTime <= now < endTime)
 * 2. Reservations that just started (within the last 15 minutes)
 * 3. Whether the robot is offline during the reservation window
 * 4. If offline, automatically refunds the deposit
 */
export const handler: Schema["processRobotReservationRefundsLambda"]["functionHandler"] = async (event) => {
  console.log("Process Robot Reservation Refunds request:", JSON.stringify(event, null, 2));

  const identity = event.identity;
  const { checkAllReservations = false } = event.arguments || {};

  // Check if user is admin (optional - can also be triggered by scheduled job)
  let isAdmin = false;
  if (identity && "username" in identity) {
    try {
      const userResponse = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: identity.username,
        })
      );
      const groups = userResponse.UserAttributes?.find(attr => attr.Name === 'cognito:groups')?.Value;
      isAdmin = groups?.includes('ADMINS') || false;
    } catch (error) {
      console.warn("Could not fetch user groups:", error);
    }
  }

  // If not admin and not a scheduled job (no identity), return error
  if (identity && !isAdmin) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Unauthorized: Only admins can process refunds" }),
    };
  }

  try {
    const now = new Date();
    const nowISO = now.toISOString();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60000).toISOString();

    // Find reservations that need to be checked
    // We check:
    // 1. Active reservations (startTime <= now < endTime) with status 'confirmed' or 'active'
    // 2. Reservations that started in the last 15 minutes (to catch ones that just started)
    const reservationsToCheck: any[] = [];

    // Query confirmed and active reservations separately (statusIndex is a GSI with status as partition key)
    const statusesToCheck = ['confirmed', 'active'];
    
    for (const status of statusesToCheck) {
      let lastEvaluatedKey: any = undefined;
      
      do {
        const queryResult = await docClient.send(
          new QueryCommand({
            TableName: ROBOT_RESERVATION_TABLE,
            IndexName: 'statusIndex',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': status,
            },
            ExclusiveStartKey: lastEvaluatedKey,
          })
        );
        
        const reservations = queryResult.Items || [];
        
        if (checkAllReservations) {
          // Include all confirmed/active reservations
          reservationsToCheck.push(...reservations);
        } else {
          // Filter to only include reservations that are currently active or just started
          for (const reservation of reservations) {
            const startTime = new Date(reservation.startTime);
            const endTime = new Date(reservation.endTime);
            
            // Include if:
            // 1. Currently active (startTime <= now < endTime)
            // 2. Just started in the last 15 minutes
            if ((startTime <= now && now < endTime) || 
                (startTime >= new Date(fifteenMinutesAgo) && startTime <= now)) {
              reservationsToCheck.push(reservation);
            }
          }
        }
        
        lastEvaluatedKey = queryResult.LastEvaluatedKey;
      } while (lastEvaluatedKey);
    }

    console.log(`Found ${reservationsToCheck.length} reservations to check`);

    const refundedReservations: any[] = [];
    const errors: any[] = [];

    // Check each reservation
    for (const reservation of reservationsToCheck) {
      try {
        // Skip if already refunded
        if (reservation.status === 'refunded' || reservation.refundedCredits > 0) {
          continue;
        }

        const robotId = reservation.robotId;
        const startTime = new Date(reservation.startTime);
        const endTime = new Date(reservation.endTime);

        // Check if robot is offline
        const robotStatusResult = await dynamoClient.send(
          new GetItemCommand({
            TableName: ROBOT_PRESENCE_TABLE,
            Key: {
              robotId: { S: robotId },
            },
          })
        );

        const isOnline = robotStatusResult.Item?.status?.S === 'online';
        const lastSeen = robotStatusResult.Item?.updatedAt?.N 
          ? parseInt(robotStatusResult.Item.updatedAt.N, 10) 
          : null;

        // Consider robot offline if:
        // 1. Not in presence table (robotStatusResult.Item is null)
        // 2. Status is not 'online'
        // 3. Last seen is more than 5 minutes ago (robot might have crashed)
        const fiveMinutesAgo = now.getTime() - 5 * 60000;
        const isRobotOffline = !isOnline || !lastSeen || lastSeen < fiveMinutesAgo;

        // If robot is offline during the reservation window, process refund
        if (isRobotOffline) {
          console.log(`Robot ${robotId} is offline during reservation ${reservation.id}, processing refund`);

          const depositCredits = reservation.depositCredits || 0;
          
          if (depositCredits > 0) {
            // Refund credits to user
            const userCreditsResult = await docClient.send(
              new GetCommand({
                TableName: USER_CREDITS_TABLE,
                Key: { id: reservation.userId },
              })
            );

            if (userCreditsResult.Item) {
              // Update user credits
              await docClient.send(
                new UpdateCommand({
                  TableName: USER_CREDITS_TABLE,
                  Key: { id: reservation.userId },
                  UpdateExpression: 'SET credits = credits + :refund, lastUpdated = :now',
                  ExpressionAttributeValues: {
                    ':refund': depositCredits,
                    ':now': nowISO,
                  },
                })
              );
            } else {
              // User doesn't have a credits record, create one
              await docClient.send(
                new UpdateCommand({
                  TableName: USER_CREDITS_TABLE,
                  Key: { id: reservation.userId },
                  UpdateExpression: 'SET credits = :refund, lastUpdated = :now',
                  ExpressionAttributeValues: {
                    ':refund': depositCredits,
                    ':now': nowISO,
                  },
                })
              );
            }

            // Update reservation with refund information
            await docClient.send(
              new UpdateCommand({
                TableName: ROBOT_RESERVATION_TABLE,
                Key: { id: reservation.id },
                UpdateExpression: 'SET #status = :status, refundedCredits = :refunded, refundReason = :reason, refundedAt = :refundedAt, updatedAt = :now',
                ExpressionAttributeNames: {
                  '#status': 'status',
                },
                ExpressionAttributeValues: {
                  ':status': 'refunded',
                  ':refunded': depositCredits,
                  ':reason': 'Robot offline during reservation time',
                  ':refundedAt': nowISO,
                  ':now': nowISO,
                },
              })
            );

            refundedReservations.push({
              reservationId: reservation.id,
              robotId: robotId,
              userId: reservation.userId,
              refundedCredits: depositCredits,
              startTime: reservation.startTime,
              endTime: reservation.endTime,
            });

            console.log(`Refunded ${depositCredits} credits to user ${reservation.userId} for reservation ${reservation.id}`);
          }
        }
      } catch (error) {
        console.error(`Error processing refund for reservation ${reservation.id}:`, error);
        errors.push({
          reservationId: reservation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Processed ${reservationsToCheck.length} reservations`,
        refundedCount: refundedReservations.length,
        refundedReservations,
        errors: errors.length > 0 ? errors : undefined,
      }),
    };
  } catch (error) {
    console.error("Error processing robot reservation refunds:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to process refunds",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

