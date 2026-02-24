import { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { randomBytes } from 'crypto';
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const handler: Schema["regenerateEnrollmentToken"]["functionHandler"] = async (event) => {
  const { robotId } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

  // Fetch robot by UUID (primary key)
  const robotResult = await ddbClient.send(
    new GetItemCommand({
      TableName: robotTableName,
      Key: { id: { S: robotId } },
    })
  );

  if (!robotResult.Item) {
    throw new Error(`Robot not found`);
  }

  const robotPartnerId = robotResult.Item.partnerId?.S;
  if (!robotPartnerId) {
    throw new Error("Robot has no partnerId - data corruption detected");
  }

  // Admin check
  const hasGroups = "groups" in identity;
  const isAdminUser = hasGroups && identity.groups
    ? identity.groups.some((g: string) => g.toUpperCase() === 'ADMINS' || g.toUpperCase() === 'ADMIN')
    : false;

  if (!isAdminUser) {
    const partnerQuery = await ddbClient.send(
      new QueryCommand({
        TableName: partnerTableName,
        IndexName: "cognitoUsernameIndex",
        KeyConditionExpression: "cognitoUsername = :username",
        ExpressionAttributeValues: {
          ":username": { S: identity.username },
        },
        Limit: 1,
      })
    );

    const partnerItem = partnerQuery.Items?.[0];
    if (!partnerItem || !partnerItem.id?.S) {
      throw new Error("No Partner found for this user");
    }

    if (partnerItem.id.S !== robotPartnerId) {
      throw new Error("Unauthorised: only the robot owner or admins can regenerate enrollment tokens");
    }
  }

  const token = randomBytes(32).toString('hex');
  const expiry = Date.now() + TOKEN_TTL_MS;

  await ddbClient.send(new UpdateItemCommand({
    TableName: robotTableName,
    Key: { id: { S: robotId } },
    UpdateExpression: 'SET #enrollmentToken = :token, #enrollmentTokenExpiry = :expiry',
    ExpressionAttributeNames: {
      '#enrollmentToken': 'enrollmentToken',
      '#enrollmentTokenExpiry': 'enrollmentTokenExpiry',
    },
    ExpressionAttributeValues: {
      ':token': { S: token },
      ':expiry': { N: expiry.toString() },
    },
  }));

  return { token, expiry };
};
