import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

// Table names from environment (set in backend.ts)
const ROBOT_RATING_TABLE = process.env.ROBOT_RATING_TABLE!;
const ROBOT_TABLE = process.env.ROBOT_TABLE_NAME!;
const SESSION_TABLE = process.env.SESSION_TABLE_NAME!;
const CLIENT_TABLE = process.env.CLIENT_TABLE_NAME!;
const PARTNER_TABLE = process.env.PARTNER_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const MINIMUM_SESSION_DURATION_SECONDS = 5 * 60; // 5 minutes

export const handler: Schema["createOrUpdateRatingLambda"]["functionHandler"] = async (event) => {
  console.log("Create/Update Rating request:", JSON.stringify(event, null, 2));

  const { robotId, rating, comment, sessionId } = event.arguments;

  if (!robotId || !rating || rating < 1 || rating > 5) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing or invalid arguments: robotId and rating (1-5) are required" }),
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

  // Get user email for domain-based checks
  let userEmail: string | undefined;
  let isModulrEmployee = false;

  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      })
    );
    userEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    isModulrEmployee = !!(userEmail && typeof userEmail === 'string' && userEmail.toLowerCase().trim().endsWith('@modulr.cloud'));
  } catch (error) {
    console.error("Could not fetch email from Cognito:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to verify user identity" }),
    };
  }

  try {
    // 1. Get robot by robotId to get robotUuid
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

    // 2. Validate session requirement (unless modulr.cloud employee)
    let session: any = null;
    let sessionDuration = 0;

    if (!isModulrEmployee) {
      if (!sessionId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Session ID is required to rate a robot (minimum 5-minute session required)" }),
        };
      }

      // Get session to validate duration
      const sessionResult = await docClient.send(
        new GetCommand({
          TableName: SESSION_TABLE,
          Key: { id: sessionId },
        })
      );

      session = sessionResult.Item;
      if (!session) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Session not found: ${sessionId}` }),
        };
      }

      if (session.userId !== userId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: "Unauthorized: You can only rate robots using your own sessions" }),
        };
      }

      if (session.robotId !== robotId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Session robotId does not match the robot being rated" }),
        };
      }

      sessionDuration = session.durationSeconds || 0;
      if (sessionDuration < MINIMUM_SESSION_DURATION_SECONDS) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Session duration (${Math.floor(sessionDuration / 60)} minutes) is less than the required minimum of 5 minutes`,
          }),
        };
      }
    }

    // 3. Get user's displayName from Client or Partner table
    let userDisplayName = "Anonymous";

    // Check Client table first
    const clientQuery = await docClient.send(
      new QueryCommand({
        TableName: CLIENT_TABLE,
        IndexName: 'cognitoUsernameIndex',
        KeyConditionExpression: 'cognitoUsername = :username',
        ExpressionAttributeValues: {
          ':username': userId,
        },
        Limit: 1,
      })
    );

    if (clientQuery.Items && clientQuery.Items.length > 0) {
      const client = clientQuery.Items[0];
      userDisplayName = client.displayName || "Anonymous";
    } else {
      // Check Partner table
      const partnerQuery = await docClient.send(
        new QueryCommand({
          TableName: PARTNER_TABLE,
          IndexName: 'cognitoUsernameIndex',
          KeyConditionExpression: 'cognitoUsername = :username',
          ExpressionAttributeValues: {
            ':username': userId,
          },
          Limit: 1,
        })
      );

      if (partnerQuery.Items && partnerQuery.Items.length > 0) {
        const partner = partnerQuery.Items[0];
        userDisplayName = partner.displayName || partner.name || "Anonymous";
      }
    }

    // 4. Check if rating already exists (one per user per robot)
    const existingRatingQuery = await docClient.send(
      new QueryCommand({
        TableName: ROBOT_RATING_TABLE,
        IndexName: 'robotIdIndex',
        KeyConditionExpression: 'robotId = :robotId',
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':robotId': robotId,
          ':userId': userId,
        },
        Limit: 1,
      })
    );

    const now = new Date().toISOString();

    if (existingRatingQuery.Items && existingRatingQuery.Items.length > 0) {
      // Update existing rating
      const existingRating = existingRatingQuery.Items[0];

      await docClient.send(
        new UpdateCommand({
          TableName: ROBOT_RATING_TABLE,
          Key: { id: existingRating.id },
          UpdateExpression: 'SET rating = :rating, #comment = :comment, updatedAt = :updatedAt, userDisplayName = :displayName',
          ExpressionAttributeNames: {
            '#comment': 'comment',
          },
          ExpressionAttributeValues: {
            ':rating': rating,
            ':comment': comment || null,
            ':updatedAt': now,
            ':displayName': userDisplayName,
          },
        })
      );

      // Recalculate robot's average rating
      await updateRobotAverageRating(robotId, robotUuid);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Rating updated successfully",
          ratingId: existingRating.id,
        }),
      };
    } else {
      // Create new rating
      const ratingId = randomUUID();

      await docClient.send(
        new PutCommand({
          TableName: ROBOT_RATING_TABLE,
          Item: {
            id: ratingId,
            robotId: robotId,
            robotUuid: robotUuid,
            userId: userId,
            userEmail: userEmail || null,
            userDisplayName: userDisplayName,
            rating: rating,
            comment: comment || null,
            sessionId: sessionId || null,
            sessionDurationSeconds: sessionDuration,
            isModulrEmployee: isModulrEmployee,
            createdAt: now,
            updatedAt: now,
          },
        })
      );

      // Update robot's average rating
      await updateRobotAverageRating(robotId, robotUuid);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Rating created successfully",
          ratingId: ratingId,
        }),
      };
    }
  } catch (error) {
    console.error("Error creating/updating rating:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `Failed to create/update rating: ${errorMessage}`,
      }),
    };
  }
};

/**
 * Helper function to calculate and update robot's average rating
 */
async function updateRobotAverageRating(robotId: string, robotUuid: string): Promise<void> {
  try {
    // Get all ratings for this robot
    const ratingsQuery = await docClient.send(
      new QueryCommand({
        TableName: ROBOT_RATING_TABLE,
        IndexName: 'robotIdIndex',
        KeyConditionExpression: 'robotId = :robotId',
        ExpressionAttributeValues: {
          ':robotId': robotId,
        },
      })
    );

    const ratings = ratingsQuery.Items || [];
    if (ratings.length === 0) {
      // No ratings, set average to null
      await docClient.send(
        new UpdateCommand({
          TableName: ROBOT_TABLE,
          Key: { id: robotUuid },
          UpdateExpression: 'SET averageRating = :null',
          ExpressionAttributeValues: {
            ':null': null,
          },
        })
      );
      return;
    }

    // Calculate average
    const sum = ratings.reduce((acc, r) => acc + (r.rating || 0), 0);
    const average = sum / ratings.length;

    // Update robot's averageRating
    await docClient.send(
      new UpdateCommand({
        TableName: ROBOT_TABLE,
        Key: { id: robotUuid },
        UpdateExpression: 'SET averageRating = :avg',
        ExpressionAttributeValues: {
          ':avg': average,
        },
      })
    );

    console.log(`Updated robot ${robotId} average rating to ${average.toFixed(2)} (from ${ratings.length} ratings)`);
  } catch (error) {
    console.error("Error updating robot average rating:", error);
    // Don't throw - this is a background update, rating creation should still succeed
  }
}

