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
const ROBOT_RATING_RESPONSE_TABLE = process.env.ROBOT_RATING_RESPONSE_TABLE!;
const ROBOT_TABLE = process.env.ROBOT_TABLE_NAME!;
const PARTNER_TABLE = process.env.PARTNER_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["createRatingResponseLambda"]["functionHandler"] = async (event) => {
  console.log("Create Rating Response request:", JSON.stringify(event, null, 2));

  const { ratingId, response } = event.arguments;

  if (!ratingId || !response || !response.trim()) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required arguments: ratingId and response are required" }),
    };
  }

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized: must be logged in with Cognito" }),
    };
  }

  const partnerId = identity.username;

  // Get partner email for domain-based checks
  let partnerEmail: string | undefined;

  try {
    const userResponse = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: partnerId,
      })
    );
    partnerEmail = userResponse.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
  } catch (error) {
    console.error("Could not fetch partner email from Cognito:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to verify partner identity" }),
    };
  }

  try {
    // 1. Get the rating to find the robot
    const ratingResult = await docClient.send(
      new GetCommand({
        TableName: ROBOT_RATING_TABLE,
        Key: { id: ratingId },
      })
    );

    const rating = ratingResult.Item;
    if (!rating) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Rating not found: ${ratingId}` }),
      };
    }

    const robotId = rating.robotId;

    // 2. Get the robot to verify ownership
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
    if (!robot || !robot.partnerId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Robot not found: ${robotId}` }),
      };
    }

    // 3. Get partner record to verify ownership
    const partnerQuery = await docClient.send(
      new QueryCommand({
        TableName: PARTNER_TABLE,
        IndexName: 'cognitoUsernameIndex',
        KeyConditionExpression: 'cognitoUsername = :username',
        ExpressionAttributeValues: {
          ':username': partnerId,
        },
        Limit: 1,
      })
    );

    const partner = partnerQuery.Items?.[0];
    if (!partner) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Unauthorized: Partner record not found" }),
      };
    }

    // 4. Verify that the requester owns the robot
    if (robot.partnerId !== partner.id) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Unauthorized: You can only respond to ratings on your own robots" }),
      };
    }

    // 5. Get partner's displayName (defaults to organization name or "Anonymous")
    const partnerDisplayName = partner.displayName || partner.name || "Anonymous";

    // 6. Check if response already exists (one response per partner per rating)
    const existingResponseQuery = await docClient.send(
      new QueryCommand({
        TableName: ROBOT_RATING_RESPONSE_TABLE,
        IndexName: 'ratingIdIndex',
        KeyConditionExpression: 'ratingId = :ratingId',
        FilterExpression: 'partnerId = :partnerId',
        ExpressionAttributeValues: {
          ':ratingId': ratingId,
          ':partnerId': partnerId,
        },
        Limit: 1,
      })
    );

    const now = new Date().toISOString();

    if (existingResponseQuery.Items && existingResponseQuery.Items.length > 0) {
      // Update existing response
      const existingResponse = existingResponseQuery.Items[0];

      await docClient.send(
        new UpdateCommand({
          TableName: ROBOT_RATING_RESPONSE_TABLE,
          Key: { id: existingResponse.id },
          UpdateExpression: 'SET response = :response, updatedAt = :updatedAt, partnerDisplayName = :displayName',
          ExpressionAttributeValues: {
            ':response': response.trim(),
            ':updatedAt': now,
            ':displayName': partnerDisplayName,
          },
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Response updated successfully",
          responseId: existingResponse.id,
        }),
      };
    } else {
      // Create new response
      const responseId = randomUUID();

      await docClient.send(
        new PutCommand({
          TableName: ROBOT_RATING_RESPONSE_TABLE,
          Item: {
            id: responseId,
            ratingId: ratingId,
            partnerId: partnerId,
            partnerEmail: partnerEmail || null,
            partnerDisplayName: partnerDisplayName,
            response: response.trim(),
            createdAt: now,
            updatedAt: now,
          },
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Response created successfully",
          responseId: responseId,
        }),
      };
    }
  } catch (error) {
    console.error("Error creating/updating rating response:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create/update rating response",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

