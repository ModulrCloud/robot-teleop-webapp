import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Deletes a PostLike record with server-side ownership verification.
 * Only the user who created the like can delete it.
 * This prevents client-side bypass attacks.
 */
export const handler: Schema["deletePostLikeLambda"]["functionHandler"] = async (event) => {
  console.log('Delete PostLike request:', JSON.stringify(event, null, 2));

  const { id } = event.arguments;
  const identity = event.identity;

  if (!identity || !("username" in identity)) {
    throw new Error("Unauthorized: must be logged in with Cognito");
  }

  const userId = identity.username;
  const POSTLIKE_TABLE = process.env.POSTLIKE_TABLE_NAME!;
  const POST_TABLE = process.env.POST_TABLE_NAME!;

  if (!POSTLIKE_TABLE || !POST_TABLE) {
    throw new Error("POSTLIKE_TABLE_NAME or POST_TABLE_NAME environment variable not set");
  }

  try {
    // Fetch the PostLike record to verify ownership
    const getResult = await docClient.send(
      new GetCommand({
        TableName: POSTLIKE_TABLE,
        Key: { id },
      })
    );

    if (!getResult.Item) {
      throw new Error(`PostLike record not found: ${id}`);
    }

    const postLike = getResult.Item;

    // SERVER-SIDE: Verify ownership (cannot be bypassed)
    if (postLike.userId !== userId) {
      console.error('❌ SECURITY: Unauthorized delete attempt', {
        recordUserId: postLike.userId,
        requesterUserId: userId,
        likeId: id,
      });
      throw new Error('Unauthorized: You can only delete your own likes');
    }

    // Delete the PostLike record
    await docClient.send(
      new DeleteCommand({
        TableName: POSTLIKE_TABLE,
        Key: { id },
      })
    );

    console.log(`✅ Successfully deleted PostLike ${id} for user ${userId}`);

    // Recalculate counts for the post
    const postId = postLike.postId;
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: POSTLIKE_TABLE,
        IndexName: 'postIdIndex',
        KeyConditionExpression: 'postId = :postId',
        ExpressionAttributeValues: {
          ':postId': postId,
        },
      })
    );

    const allLikes = queryResult.Items || [];
    const likes = allLikes.filter(like => like.type === 'like').length;
    const dislikes = allLikes.filter(like => like.type === 'dislike').length;

    // Update Post record with accurate counts
    await docClient.send(
      new UpdateCommand({
        TableName: POST_TABLE,
        Key: { id: postId },
        UpdateExpression: 'SET likesCount = :likes, dislikesCount = :dislikes',
        ExpressionAttributeValues: {
          ':likes': likes,
          ':dislikes': dislikes,
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'PostLike deleted successfully',
        deletedId: id,
        postId: postId,
        updatedCounts: { likes, dislikes },
      }),
    };
  } catch (error) {
    console.error('Error deleting PostLike:', error);
    throw error;
  }
};
