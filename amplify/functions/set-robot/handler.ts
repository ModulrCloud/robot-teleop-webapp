import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
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

  // Create the Robot item
  const robot = {
    id,
    robotName,
    description,
    model,
    partnerId,
    __typename: 'Robot',
  };

  // Convert JS object to DynamoDB AttributeValues
  const putItemInput = {
    TableName: robotTableName,
    Item: {
      id: { S: robot.id },
      name: { S: robot.robotName },
      description: { S: robot.description ?? "" },
      model: { S: robot.model ?? "" },
      partnerId: { S: robot.partnerId },
      __typename: { S: robot.__typename },
    },
  };

  // Put the Robot into DynamoDB
  await ddbClient.send(new PutItemCommand(putItemInput));

  return JSON.stringify(robot);
};