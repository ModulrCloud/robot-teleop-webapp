import type { Schema } from "../../data/resource";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, QueryCommandInput, ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognito = new CognitoIdentityProviderClient({});

const ROBOT_RESERVATION_TABLE = process.env.ROBOT_RESERVATION_TABLE!;
const ROBOT_TABLE = process.env.ROBOT_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Schema["listRobotReservationsLambda"]["functionHandler"] = async (event) => {
  console.log("List Robot Reservations request:", JSON.stringify(event, null, 2));

  const { robotId, userId, partnerId, status, startTime, endTime, limit = 20, nextToken } = event.arguments;
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
    // Check if requester is admin
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
    let reservations: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
    const resolvedLimit = typeof limit === 'number' ? limit : 20;

    // Build filter expression
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};
    const expressionAttributeNames: Record<string, string> = {};

    if (status) {
      filterExpressions.push('#status = :status');
      expressionAttributeValues[':status'] = status;
      expressionAttributeNames['#status'] = 'status';
    }

    if (startTime) {
      filterExpressions.push('startTime >= :startTime');
      expressionAttributeValues[':startTime'] = startTime;
    }

    if (endTime) {
      filterExpressions.push('endTime <= :endTime');
      expressionAttributeValues[':endTime'] = endTime;
    }

    // Query based on filter
    if (robotId) {
      // Query by robotId
      const queryParams: QueryCommandInput = {
        TableName: ROBOT_RESERVATION_TABLE,
        IndexName: 'robotIdIndex',
        KeyConditionExpression: 'robotId = :robotId',
        ExpressionAttributeValues: {
          ':robotId': robotId,
          ...expressionAttributeValues,
        },
        Limit: resolvedLimit,
        ScanIndexForward: false, // Newest first
      };

      if (filterExpressions.length > 0) {
        queryParams.FilterExpression = filterExpressions.join(' AND ');
        if (Object.keys(expressionAttributeNames).length > 0) {
          queryParams.ExpressionAttributeNames = expressionAttributeNames;
        }
      }

      if (nextToken) {
        queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'));
      }

      const result = await docClient.send(new QueryCommand(queryParams));
      reservations = result.Items || [];
      lastEvaluatedKey = result.LastEvaluatedKey;
    } else if (userId) {
      // Query by userId (only if requester is the user or admin)
      if (!isAdmin && userId !== requesterId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: "Unauthorized: You can only view your own reservations" }),
        };
      }

      const queryParams: QueryCommandInput = {
        TableName: ROBOT_RESERVATION_TABLE,
        IndexName: 'userIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
          ...expressionAttributeValues,
        },
        Limit: resolvedLimit,
        ScanIndexForward: false,
      };

      if (filterExpressions.length > 0) {
        queryParams.FilterExpression = filterExpressions.join(' AND ');
        if (Object.keys(expressionAttributeNames).length > 0) {
          queryParams.ExpressionAttributeNames = expressionAttributeNames;
        }
      }

      if (nextToken) {
        queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'));
      }

      const result = await docClient.send(new QueryCommand(queryParams));
      reservations = result.Items || [];
      lastEvaluatedKey = result.LastEvaluatedKey;
    } else if (partnerId) {
      // Query by partnerId (only if requester is the partner or admin)
      if (!isAdmin && partnerId !== requesterId) {
        // Verify requester owns robots for this partner
        const robotQuery = await docClient.send(
          new QueryCommand({
            TableName: ROBOT_TABLE,
            FilterExpression: 'partnerId = :partnerId',
            ExpressionAttributeValues: {
              ':partnerId': partnerId,
            },
            Limit: 1,
          })
        );
        
        if (!robotQuery.Items || robotQuery.Items.length === 0) {
          return {
            statusCode: 403,
            body: JSON.stringify({ error: "Unauthorized: You can only view reservations for your own robots" }),
          };
        }
      }

      const queryParams: QueryCommandInput = {
        TableName: ROBOT_RESERVATION_TABLE,
        IndexName: 'partnerIdIndex',
        KeyConditionExpression: 'partnerId = :partnerId',
        ExpressionAttributeValues: {
          ':partnerId': partnerId,
          ...expressionAttributeValues,
        },
        Limit: resolvedLimit,
        ScanIndexForward: false,
      };

      if (filterExpressions.length > 0) {
        queryParams.FilterExpression = filterExpressions.join(' AND ');
        if (Object.keys(expressionAttributeNames).length > 0) {
          queryParams.ExpressionAttributeNames = expressionAttributeNames;
        }
      }

      if (nextToken) {
        queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'));
      }

      const result = await docClient.send(new QueryCommand(queryParams));
      reservations = result.Items || [];
      lastEvaluatedKey = result.LastEvaluatedKey;
    } else {
      // No specific filter - return user's own reservations (or all if admin)
      if (isAdmin) {
        // Admin can see all
        const scanParams: ScanCommandInput = {
          TableName: ROBOT_RESERVATION_TABLE,
          Limit: resolvedLimit,
        };

        if (filterExpressions.length > 0) {
          scanParams.FilterExpression = filterExpressions.join(' AND ');
          scanParams.ExpressionAttributeValues = expressionAttributeValues;
          if (Object.keys(expressionAttributeNames).length > 0) {
            scanParams.ExpressionAttributeNames = expressionAttributeNames;
          }
        }

        if (nextToken) {
          scanParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'));
        }

        const result = await docClient.send(new ScanCommand(scanParams));
        reservations = result.Items || [];
        lastEvaluatedKey = result.LastEvaluatedKey;
      } else {
        // Regular user sees only their own
        const queryParams: QueryCommandInput = {
          TableName: ROBOT_RESERVATION_TABLE,
          IndexName: 'userIdIndex',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': requesterId,
            ...expressionAttributeValues,
          },
          Limit: resolvedLimit,
          ScanIndexForward: false,
        };

        if (filterExpressions.length > 0) {
          queryParams.FilterExpression = filterExpressions.join(' AND ');
          if (Object.keys(expressionAttributeNames).length > 0) {
            queryParams.ExpressionAttributeNames = expressionAttributeNames;
          }
        }

        if (nextToken) {
          queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'));
        }

        const result = await docClient.send(new QueryCommand(queryParams));
        reservations = result.Items || [];
        lastEvaluatedKey = result.LastEvaluatedKey;
      }
    }

    // Filter sensitive data if not admin
    const filteredReservations = reservations.map(reservation => {
      if (isAdmin) {
        return reservation; // Admins see everything
      }
      
      const filtered: Record<string, unknown> = { ...reservation };
      const reservationUserId = typeof filtered.userId === 'string' ? filtered.userId : undefined;
      if (reservationUserId !== requesterId) {
        delete filtered.userEmail;
      }
      return filtered;
    });

    const encodedNextToken = lastEvaluatedKey 
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64') 
      : undefined;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        reservations: filteredReservations,
        nextToken: encodedNextToken,
      }),
    };
  } catch (error) {
    console.error("Error listing reservations:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to list reservations",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

