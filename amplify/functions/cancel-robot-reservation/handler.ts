import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const ROBOT_RESERVATION_TABLE = process.env.ROBOT_RESERVATION_TABLE!;
const USER_CREDITS_TABLE = process.env.USER_CREDITS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["cancelRobotReservationLambda"]["functionHandler"] = async (event) => {
  console.log("Cancel Robot Reservation request:", JSON.stringify(event, null, 2));

  const { reservationId, reason } = event.arguments;
  const identity = event.identity;

  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized: must be logged in with Cognito" }),
    };
  }

  const requesterId = identity.username;
  let isAdmin = false;

  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: requesterId,
      })
    );
    const groups = userResponse.UserAttributes?.find(attr => attr.Name === 'cognito:groups')?.Value;
    isAdmin = groups?.includes('ADMINS') || false;
  } catch (error) {
    console.warn("Could not fetch user groups:", error);
  }

  try {
    // Get reservation
    const reservationResult = await docClient.send(
      new GetCommand({
        TableName: ROBOT_RESERVATION_TABLE,
        Key: { id: reservationId },
      })
    );

    const reservation = reservationResult.Item;
    if (!reservation) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Reservation not found: ${reservationId}` }),
      };
    }

    // Check authorization (user owns reservation or is admin)
    if (!isAdmin && reservation.userId !== requesterId) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Unauthorized: You can only cancel your own reservations" }),
      };
    }

    // Check if reservation can be cancelled
    if (reservation.status === 'cancelled') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Reservation is already cancelled" }),
      };
    }

    if (reservation.status === 'completed') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Cannot cancel a completed reservation" }),
      };
    }

    // Update reservation status
    const nowISO = new Date().toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: ROBOT_RESERVATION_TABLE,
        Key: { id: reservationId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now, refundReason = :reason',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'cancelled',
          ':now': nowISO,
          ':reason': reason || 'Cancelled by user',
        },
      })
    );

    // Refund deposit (no refunds except if robot was offline - handled separately)
    // For user-initiated cancellations, we don't refund (per requirements)
    // But we'll still update the reservation status

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Reservation cancelled successfully",
        note: "Deposit is non-refundable for user-initiated cancellations",
      }),
    };
  } catch (error) {
    console.error("Error cancelling reservation:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to cancel reservation",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

