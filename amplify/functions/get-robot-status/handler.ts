import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { Schema } from '../../data/resource';

const ROBOT_PRESENCE_TABLE = process.env.ROBOT_PRESENCE_TABLE!;
const db = new DynamoDBClient({});

export const handler: Schema["getRobotStatusLambda"]["functionHandler"] = async (event) => {
  const { robotId } = event.arguments;

  if (!robotId) {
    return {
      isOnline: false,
      lastSeen: undefined,
      status: undefined,
    };
  }

  try {
    const result = await db.send(
      new GetItemCommand({
        TableName: ROBOT_PRESENCE_TABLE,
        Key: {
          robotId: { S: robotId },
        },
      })
    );

    if (!result.Item) {
      // Robot not found in presence table = offline
      return {
        isOnline: false,
        lastSeen: undefined,
        status: undefined,
      };
    }

    const status = result.Item.status?.S;
    const updatedAt = result.Item.updatedAt?.N;

    return {
      isOnline: status === 'online',
      lastSeen: updatedAt ? parseInt(updatedAt, 10) : undefined,
      status: status || undefined,
    };
  } catch (error) {
    console.error('Error checking robot status:', error);
    // On error, assume offline
    return {
      isOnline: false,
      lastSeen: undefined,
      status: undefined,
    };
  }
};

