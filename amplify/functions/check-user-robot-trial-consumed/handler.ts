import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Schema } from "../../data/resource";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Returns whether the caller has already used their one-time trial on this robot
 * (UserRobotTrialConsumption row). Only reads the composite key for the authenticated user.
 */
export const handler: Schema["checkUserRobotTrialConsumedLambda"]["functionHandler"] = async (event) => {
  const { robotId } = event.arguments;
  const identity = event.identity;

  if (!robotId || !identity || !("username" in identity)) {
    return { consumed: false };
  }

  const tableName = process.env.USER_ROBOT_TRIAL_CONSUMPTION_TABLE_NAME;
  if (!tableName) {
    return { consumed: false };
  }

  const userId = identity.username;

  try {
    const res = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { userId, robotId },
      }),
    );
    return { consumed: Boolean(res.Item) };
  } catch (err) {
    console.error("[checkUserRobotTrialConsumed]", { robotId, userId, err });
    return { consumed: false };
  }
};
