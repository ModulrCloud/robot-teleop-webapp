/**
 * Utility functions for updating post data without full reload
 * 
 * These functions allow updating specific fields (counts, timestamps, etc.)
 * without triggering a full post reload, preventing UI blinks and improving UX.
 * 
 * Used for:
 * - Like/dislike counts
 * - Comment counts
 * - Share counts
 * - Post timestamps (relative time updates)
 * - Any other field that changes frequently
 */

import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

/**
 * Updates a post's counts (likes, dislikes, comments, shares) without full reload
 * 
 * @param postId - The post ID to update
 * @param updates - Partial object with count fields to update
 * @returns Promise that resolves when update is complete
 */
export async function updatePostCounts(
  postId: string,
  updates: {
    likesCount?: number;
    dislikesCount?: number;
    commentsCount?: number;
    sharesCount?: number;
  }
): Promise<void> {
  try {
    await client.models.Post.update({
      id: postId,
      ...updates,
    });
  } catch (error) {
    console.error(`Failed to update post counts for ${postId}:`, error);
    throw error;
  }
}

/**
 * Recalculates and updates post counts from source of truth (PostLike records)
 * 
 * This ensures accuracy even with concurrent updates from multiple users.
 * 
 * @param postId - The post ID to recalculate counts for
 * @returns Promise with the calculated counts
 */
export async function recalculatePostCounts(postId: string): Promise<{
  likesCount: number;
  dislikesCount: number;
}> {
  try {
    // Fetch all likes/dislikes for this post
    const { data: allLikes } = await client.models.PostLike.list({
      filter: {
        postId: { eq: postId },
      },
    });

    // Calculate actual counts
    const likesCount = allLikes?.filter(like => like.type === 'like').length || 0;
    const dislikesCount = allLikes?.filter(like => like.type === 'dislike').length || 0;

    // Update Post record with accurate counts
    await updatePostCounts(postId, { likesCount, dislikesCount });

    return { likesCount, dislikesCount };
  } catch (error) {
    console.error(`Failed to recalculate counts for post ${postId}:`, error);
    throw error;
  }
}

/**
 * Updates a post's timestamp-related fields
 * 
 * Useful for updating relative time displays ("2 minutes ago" → "3 minutes ago")
 * without full reload.
 * 
 * @param postId - The post ID to update
 * @param updates - Timestamp fields to update
 */
export async function updatePostTimestamps(
  postId: string,
  updates: {
    updatedAt?: string;
    lastActivityAt?: string;
  }
): Promise<void> {
  try {
    await client.models.Post.update({
      id: postId,
      ...updates,
    });
  } catch (error) {
    console.error(`Failed to update post timestamps for ${postId}:`, error);
    throw error;
  }
}

/**
 * Generic function to update any post field without full reload
 * 
 * Use this for any field updates that don't require a full post reload.
 * 
 * @param postId - The post ID to update
 * @param updates - Partial Post object with fields to update
 */
export async function updatePostFields(
  postId: string,
  updates: Partial<{
    likesCount: number;
    dislikesCount: number;
    commentsCount: number;
    sharesCount: number;
    updatedAt: string;
    lastActivityAt: string;
    // Add other fields as needed
  }>
): Promise<void> {
  try {
    await client.models.Post.update({
      id: postId,
      ...updates,
    });
  } catch (error) {
    console.error(`Failed to update post fields for ${postId}:`, error);
    throw error;
  }
}
