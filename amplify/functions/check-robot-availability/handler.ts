import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

    const conflictingReservations = reservationsQuery.Items || [];

    // Check for availability blocks
    const availabilityQuery = await docClient.send(
      new QueryCommand({
        TableName: ROBOT_AVAILABILITY_TABLE,
        IndexName: 'robotIdIndex',
        KeyConditionExpression: 'robotId = :robotId',
        FilterExpression: '(startTime <= :start AND endTime > :start) OR (startTime < :end AND endTime >= :end) OR (startTime >= :start AND endTime <= :end)',
        ExpressionAttributeValues: {
          ':robotId': robotId,
          ':start': start.toISOString(),
          ':end': end.toISOString(),
        },
      })
    );

    const availabilityBlocks = availabilityQuery.Items || [];

    // Check recurring availability blocks
    let hasRecurringConflict = false;
    for (const block of availabilityBlocks) {
      if (block.isRecurring && block.recurrencePattern) {
        try {
          const pattern = JSON.parse(block.recurrencePattern);
          if (pattern.type === 'weekly' && Array.isArray(pattern.daysOfWeek)) {
            // Check if the requested time falls on one of the recurring days
            const startDayOfWeek = start.getDay();
            const endDayOfWeek = end.getDay();
            
            // Get the time components from the original block
            const originalStart = new Date(block.startTime);
            const originalEnd = new Date(block.endTime);
            const originalStartHour = originalStart.getHours();
            const originalStartMinute = originalStart.getMinutes();
            const originalEndHour = originalEnd.getHours();
            const originalEndMinute = originalEnd.getMinutes();
            
            // Check if start or end day matches the pattern
            if (pattern.daysOfWeek.includes(startDayOfWeek) || pattern.daysOfWeek.includes(endDayOfWeek)) {
              // Check if we've passed the end date (if specified)
              if (!pattern.endDate || start <= new Date(pattern.endDate)) {
                // Create instance times for the start day
                const instanceStart = new Date(start);
                instanceStart.setHours(originalStartHour, originalStartMinute, 0, 0);
                
                const instanceEnd = new Date(start);
                instanceEnd.setHours(originalEndHour, originalEndMinute, 0, 0);
                
                // If end time is before start time, it spans to next day
                if (instanceEnd < instanceStart) {
                  instanceEnd.setDate(instanceEnd.getDate() + 1);
                }
                
                // Check for overlap
                if (start < instanceEnd && end > instanceStart) {
                  hasRecurringConflict = true;
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.warn('Failed to parse recurrence pattern:', e);
        }
      }
    }

    const available = conflictingReservations.length === 0 && availabilityBlocks.length === 0 && !hasRecurringConflict;

    let reason: string | undefined;
    if (!available) {
      if (conflictingReservations.length > 0) {
        reason = `Robot is already reserved during this time (${conflictingReservations.length} conflicting reservation(s))`;
      } else if (availabilityBlocks.length > 0) {
        reason = `Robot is blocked by partner during this time (${availabilityBlocks.length} block(s))`;
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

