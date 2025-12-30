import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const ROBOT_AVAILABILITY_TABLE = process.env.ROBOT_AVAILABILITY_TABLE!;
const ROBOT_TABLE = process.env.ROBOT_TABLE_NAME!;
const ROBOT_RESERVATION_TABLE = process.env.ROBOT_RESERVATION_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["manageRobotAvailabilityLambda"]["functionHandler"] = async (event) => {
  console.log("Manage Robot Availability request:", JSON.stringify(event, null, 2));

  const { robotId, action, availabilityId, startTime, endTime, reason, isRecurring, recurrencePattern } = event.arguments;
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
    // Get robot to verify ownership
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

    // Check authorization (partner owns robot or is admin)
    if (!isAdmin && robot.partnerId !== requesterId) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Unauthorized: You can only manage availability for your own robots" }),
      };
    }

    const robotUuid = robot.id;
    const partnerId = robot.partnerId;
    const nowISO = new Date().toISOString();

    if (action === 'create') {
      if (!startTime || !endTime) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "startTime and endTime are required for create action" }),
        };
      }

      const start = new Date(startTime);
      const end = new Date(endTime);

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

      // Check for conflicting reservations
      const reservationsQuery = await docClient.send(
        new QueryCommand({
          TableName: ROBOT_RESERVATION_TABLE,
          IndexName: 'robotIdIndex',
          KeyConditionExpression: 'robotId = :robotId',
          FilterExpression: 'status IN (:pending, :confirmed, :active) AND ((startTime <= :start AND endTime > :start) OR (startTime < :end AND endTime >= :end) OR (startTime >= :start AND endTime <= :end))',
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
        return {
          statusCode: 409,
          body: JSON.stringify({ error: "Cannot block time that conflicts with existing reservations" }),
        };
      }

      const newAvailabilityId = randomUUID();
      await docClient.send(
        new PutCommand({
          TableName: ROBOT_AVAILABILITY_TABLE,
          Item: {
            id: newAvailabilityId,
            robotId,
            robotUuid,
            partnerId,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            reason: reason || null,
            isRecurring: isRecurring || false,
            recurrencePattern: recurrencePattern || null,
            createdAt: nowISO,
            updatedAt: nowISO,
          },
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          availabilityId: newAvailabilityId,
          message: "Availability block created successfully",
        }),
      };
    } else if (action === 'update') {
      if (!availabilityId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "availabilityId is required for update action" }),
        };
      }

      const existingAvailability = await docClient.send(
        new GetCommand({
          TableName: ROBOT_AVAILABILITY_TABLE,
          Key: { id: availabilityId },
        })
      );

      if (!existingAvailability.Item) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Availability block not found: ${availabilityId}` }),
        };
      }

      // Verify ownership
      if (!isAdmin && existingAvailability.Item.partnerId !== requesterId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: "Unauthorized: You can only update your own availability blocks" }),
        };
      }

      const updateExpressions: string[] = [];
      const expressionAttributeValues: Record<string, any> = {};

      if (startTime) {
        updateExpressions.push('startTime = :startTime');
        expressionAttributeValues[':startTime'] = new Date(startTime).toISOString();
      }

      if (endTime) {
        updateExpressions.push('endTime = :endTime');
        expressionAttributeValues[':endTime'] = new Date(endTime).toISOString();
      }

      if (reason !== undefined) {
        updateExpressions.push('reason = :reason');
        expressionAttributeValues[':reason'] = reason || null;
      }

      if (isRecurring !== undefined) {
        updateExpressions.push('isRecurring = :isRecurring');
        expressionAttributeValues[':isRecurring'] = isRecurring;
      }

      if (recurrencePattern !== undefined) {
        updateExpressions.push('recurrencePattern = :recurrencePattern');
        expressionAttributeValues[':recurrencePattern'] = recurrencePattern || null;
      }

      updateExpressions.push('updatedAt = :now');
      expressionAttributeValues[':now'] = nowISO;

      await docClient.send(
        new UpdateCommand({
          TableName: ROBOT_AVAILABILITY_TABLE,
          Key: { id: availabilityId },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Availability block updated successfully",
        }),
      };
    } else if (action === 'delete') {
      if (!availabilityId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "availabilityId is required for delete action" }),
        };
      }

      const existingAvailability = await docClient.send(
        new GetCommand({
          TableName: ROBOT_AVAILABILITY_TABLE,
          Key: { id: availabilityId },
        })
      );

      if (!existingAvailability.Item) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Availability block not found: ${availabilityId}` }),
        };
      }

      // Verify ownership
      if (!isAdmin && existingAvailability.Item.partnerId !== requesterId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: "Unauthorized: You can only delete your own availability blocks" }),
        };
      }

      await docClient.send(
        new DeleteCommand({
          TableName: ROBOT_AVAILABILITY_TABLE,
          Key: { id: availabilityId },
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Availability block deleted successfully",
        }),
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Invalid action: ${action}. Must be 'create', 'update', or 'delete'` }),
      };
    }
  } catch (error) {
    console.error("Error managing availability:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to manage availability",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

