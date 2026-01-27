import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

// Table names from environment (set in backend.ts)
const ROBOT_RATING_TABLE = process.env.ROBOT_RATING_TABLE!;
const ROBOT_RATING_RESPONSE_TABLE = process.env.ROBOT_RATING_RESPONSE_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const DEFAULT_LIMIT = 10; // Default pagination limit

export const handler: Schema["listRobotRatingsLambda"]["functionHandler"] = async (event) => {
  console.log("List Robot Ratings request:", JSON.stringify(event, null, 2));

  const { robotId, limit = DEFAULT_LIMIT, nextToken } = event.arguments;

  if (!robotId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required argument: robotId" }),
    };
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized: must be logged in with Cognito" }),
    };
  }

  // Get requester's email to check if they're a modulr.cloud employee (for moderation visibility)
  let requesterEmail: string | undefined;
  let isModulrEmployee = false;

  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: identity.username,
      })
    );
    requesterEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    isModulrEmployee = !!(requesterEmail && typeof requesterEmail === 'string' && requesterEmail.toLowerCase().trim().endsWith('@modulr.cloud'));
  } catch (error) {
    console.warn("Could not fetch requester email from Cognito:", error);
    // Continue without admin visibility - safer to hide sensitive data
  }

  try {
    // Query ratings for this robot
    const queryParams: any = {
      TableName: ROBOT_RATING_TABLE,
      IndexName: 'robotIdIndex',
      KeyConditionExpression: 'robotId = :robotId',
      ExpressionAttributeValues: {
        ':robotId': robotId,
      },
      Limit: limit,
      ScanIndexForward: false, // Sort by createdAt descending (newest first)
    };

    // Handle pagination token if provided
    if (nextToken) {
      try {
        const decodedToken = Buffer.from(nextToken, 'base64').toString('utf-8');
        const tokenData = JSON.parse(decodedToken);
        queryParams.ExclusiveStartKey = tokenData.lastEvaluatedKey;
      } catch (e) {
        console.warn("Invalid pagination token, ignoring:", e);
      }
    }

    const ratingsResult = await docClient.send(new QueryCommand(queryParams));

    const currentUserId = identity.username;
    
    const ratings = (ratingsResult.Items || []).map((rating: any) => {
      // Filter sensitive data for non-admins
      const sanitizedRating: any = {
        id: rating.id,
        robotId: rating.robotId,
        rating: rating.rating,
        comment: rating.comment,
        userDisplayName: rating.userDisplayName || "Anonymous",
        createdAt: rating.createdAt,
        updatedAt: rating.updatedAt,
        isOwnRating: rating.userId === currentUserId,
      };

      // Only include userId and userEmail for modulr.cloud employees (for moderation)
      if (isModulrEmployee) {
        sanitizedRating.userId = rating.userId;
        sanitizedRating.userEmail = rating.userEmail;
      }

      return sanitizedRating;
    });

    // Fetch responses for each rating (if any)
    for (const rating of ratings) {
      try {
        const responsesResult = await docClient.send(
          new QueryCommand({
            TableName: ROBOT_RATING_RESPONSE_TABLE,
            IndexName: 'ratingIdIndex',
            KeyConditionExpression: 'ratingId = :ratingId',
            ExpressionAttributeValues: {
              ':ratingId': rating.id,
            },
          })
        );

        const responses = (responsesResult.Items || []).map((response: any) => {
          const sanitizedResponse: any = {
            id: response.id,
            response: response.response,
            partnerDisplayName: response.partnerDisplayName || "Anonymous",
            createdAt: response.createdAt,
            updatedAt: response.updatedAt,
          };

          // Only include partnerId and partnerEmail for modulr.cloud employees
          if (isModulrEmployee) {
            sanitizedResponse.partnerId = response.partnerId;
            sanitizedResponse.partnerEmail = response.partnerEmail;
          }

          return sanitizedResponse;
        });

        rating.responses = responses;
      } catch (error) {
        console.warn(`Failed to fetch responses for rating ${rating.id}:`, error);
        rating.responses = [];
      }
    }

    // Generate pagination token if there are more results
    let paginationToken: string | null = null;
    if (ratingsResult.LastEvaluatedKey) {
      const tokenData = {
        lastEvaluatedKey: ratingsResult.LastEvaluatedKey,
      };
      paginationToken = Buffer.from(JSON.stringify(tokenData)).toString('base64');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ratings: ratings,
        nextToken: paginationToken,
        count: ratings.length,
      }),
    };
  } catch (error) {
    console.error("Error listing robot ratings:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to list robot ratings",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

