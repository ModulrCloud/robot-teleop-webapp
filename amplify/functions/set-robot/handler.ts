import { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from "uuid";
import { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});

export const handler: Schema["setRobotLambda"]["functionHandler"] = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const { robotName, description, model } = event.arguments;

  const identity = event.identity;
  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorised: must be logged in with Cognito");
  }

  const robotTableName = process.env.ROBOT_TABLE_NAME!;
  const partnerTableName = process.env.PARTNER_TABLE_NAME!;

  if (!robotTableName || !partnerTableName) {
    throw new Error("ROBOT_TABLE_NAME or PARTNER_TABLE_NAME environment variable not set");
  }

  // Lookup the Partner record for this user
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

  // Generate an ID for the robot
  const id = uuidv4();
  
  // Generate robotId (used for WebSocket connections) - use a simple format
  // In production, you might want to use a more sophisticated ID generation
  const robotIdValue = `robot-${id.substring(0, 8)}`;
  
  // Get current timestamp in AWSDateTime format (full ISO 8601) for createdAt/updatedAt
  // Amplify automatically adds createdAt/updatedAt as AWSDateTime (not AWSDate)
  // Format: YYYY-MM-DDTHH:mm:ss.sssZ (e.g., "2024-01-15T10:30:00.000Z")
  const now = new Date().toISOString();

  // Create the Robot item
  const robot = {
    id,
    robotName,
    description,
    model,
    partnerId,
    robotId: robotIdValue,
    __typename: 'Robot',
  };

  // Convert JS object to DynamoDB AttributeValues
  // Amplify models automatically include createdAt and updatedAt fields
  const putItemInput = {
    TableName: robotTableName,
    Item: {
      id: { S: robot.id },
      name: { S: robot.robotName },
      description: { S: robot.description ?? "" },
      model: { S: robot.model ?? "" },
      partnerId: { S: robot.partnerId },
      robotId: { S: robot.robotId },
      createdAt: { S: now }, // Required by Amplify GraphQL schema
      updatedAt: { S: now }, // Required by Amplify GraphQL schema
      __typename: { S: robot.__typename },
    },
  };

  // Put the Robot into DynamoDB
  console.log('📝 Writing robot to DynamoDB:', {
    tableName: robotTableName,
    item: {
      id: robot.id,
      name: robot.robotName,
      description: robot.description,
      model: robot.model,
      partnerId: robot.partnerId,
      robotId: robot.robotId,
      createdAt: now,
      updatedAt: now,
    },
  });
  
  // Log the actual DynamoDB item structure being written
  console.log('📋 DynamoDB PutItemCommand payload:', JSON.stringify(putItemInput, null, 2));
  
  await ddbClient.send(new PutItemCommand(putItemInput));
  
  console.log('✅ Robot successfully written to DynamoDB:', robot.id);
  
  // Verify what was written by reading it back
  try {
    const verifyRead = await ddbClient.send(new GetItemCommand({
      TableName: robotTableName,
      Key: { id: { S: robot.id } },
    }));
    console.log('🔍 Verification - Robot read back from DynamoDB:', {
      hasItem: !!verifyRead.Item,
      createdAt: verifyRead.Item?.createdAt?.S || '❌ MISSING',
      updatedAt: verifyRead.Item?.updatedAt?.S || '❌ MISSING',
      allFields: verifyRead.Item,
    });
  } catch (verifyError) {
    console.warn('⚠️ Could not verify robot write:', verifyError);
  }

  return JSON.stringify(robot);
};