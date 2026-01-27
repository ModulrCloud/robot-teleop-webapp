import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { hasRecurringConflict } from '../utils/recurrence';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ROBOT_RESERVATION_TABLE = process.env.ROBOT_RESERVATION_TABLE!;
const ROBOT_AVAILABILITY_TABLE = process.env.ROBOT_AVAILABILITY_TABLE!;


export const handler: Schema["checkRobotAvailabilityLambda"]["functionHandler"] = async (event) => {
  console.log("Check Robot Availability request:", JSON.stringify(event, null, 2));

  const { robotId, startTime, endTime } = event.arguments;

  if (!robotId || !startTime || !endTime) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required arguments: robotId, startTime, and endTime are required" }),
    };
  }

  try {
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

    const conflictingReservations = reservationsQuery.Items || [];

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

    const availabilityBlocks = availabilityQuery.Items || [];

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

    const recurringBlocks = (recurringQuery.Items || [])
      .filter((block): block is { startTime: string; endTime: string; recurrencePattern?: string } => {
        return typeof block?.startTime === 'string' && typeof block?.endTime === 'string';
      });
    const hasRecurringBlockConflict = hasRecurringConflict(recurringBlocks, start, end);

    const available = conflictingReservations.length === 0 && availabilityBlocks.length === 0 && !hasRecurringBlockConflict;

    let reason: string | undefined;
    if (!available) {
      if (conflictingReservations.length > 0) {
        reason = `Robot is already reserved during this time (${conflictingReservations.length} conflicting reservation(s))`;
      } else if (availabilityBlocks.length > 0) {
        reason = `Robot is blocked by partner during this time (${availabilityBlocks.length} block(s))`;
      } else if (hasRecurringBlockConflict) {
        reason = 'Robot is blocked by partner during this time (recurring schedule)';
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        available,
        reason,
        conflictingReservations: available ? [] : conflictingReservations.map(r => ({
          id: r.id,
          startTime: r.startTime,
          endTime: r.endTime,
          status: r.status,
        })),
        availabilityBlocks: available ? [] : availabilityBlocks.map(b => ({
          id: b.id,
          startTime: b.startTime,
          endTime: b.endTime,
          reason: b.reason,
        })),
      }),
    };
  } catch (error) {
    console.error("Error checking availability:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to check availability",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

