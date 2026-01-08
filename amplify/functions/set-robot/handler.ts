import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from "uuid";
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

export const handler: Schema["setRobotLambda"]["functionHandler"] = async (event) => {
  const { robotName, description, model, robotType, hourlyRateCredits, enableAccessControl, additionalAllowedUsers, imageUrl, city, state, country, latitude, longitude } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

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
  const partnerId = partnerItem.id.S;

  const id = uuidv4();
  const robotIdValue = `robot-${id.substring(0, 8)}`;
  const now = new Date().toISOString();

  const robot = {
    id,
    robotName,
    description,
    model,
    partnerId,
    robotId: robotIdValue,
    __typename: 'Robot',
  };

  const putItemInput: Record<string, unknown> = {
    TableName: robotTableName,
    Item: {
      id: { S: robot.id },
      name: { S: robot.robotName },
      description: { S: robot.description ?? "" },
      model: { S: robot.model ?? "" },
      robotType: { S: robotType ?? model ?? "robot" },
      isVerified: { BOOL: false },
      partnerId: { S: robot.partnerId },
      robotId: { S: robot.robotId },
      createdAt: { S: now },
      updatedAt: { S: now },
      __typename: { S: robot.__typename },
    },
  };

  const item = putItemInput.Item as Record<string, unknown>;

  if (imageUrl) {
    item.imageUrl = { S: imageUrl };
  }

  const rateCredits = hourlyRateCredits ?? 100;
  item.hourlyRateCredits = { N: rateCredits.toString() };

  if (city) item.city = { S: city };
  if (state) item.state = { S: state };
  if (country) item.country = { S: country };
  if (latitude !== undefined && latitude !== null) {
    item.latitude = { N: latitude.toString() };
  }
  if (longitude !== undefined && longitude !== null) {
    item.longitude = { N: longitude.toString() };
  }

  if (enableAccessControl === true) {
    const ownerUsername = identity.username;
    const identityAny = identity as unknown as { email?: string; claims?: { email?: string } };
    const ownerEmail = identityAny.email || identityAny.claims?.email;
    
    const defaultAllowedUsers = [
      ownerUsername.toLowerCase().trim(),
      'chris@modulr.cloud',
      'mike@modulr.cloud',
    ];
    
    if (ownerEmail && ownerEmail.toLowerCase().trim() !== ownerUsername.toLowerCase().trim()) {
      defaultAllowedUsers.push(ownerEmail.toLowerCase().trim());
    }
    
    const additionalUsers = (additionalAllowedUsers || [])
      .filter((email): email is string => email != null && typeof email === 'string')
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email.length > 0 && email.includes('@'));
    
    const allAllowedUsers = Array.from(new Set([...defaultAllowedUsers, ...additionalUsers]));
    item.allowedUsers = { SS: allAllowedUsers };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ddbClient.send(new PutItemCommand(putItemInput as any));

  return JSON.stringify(robot);
};
