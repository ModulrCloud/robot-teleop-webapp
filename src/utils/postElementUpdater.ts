/**
 * Standard method for updating individual post elements without full page reload
 * 
 * This provides a consistent pattern for updating any post element (like button, 
 * comment count, share count, etc.) with:
 * - Optimistic UI updates (instant feedback)
 * - Background database sync
 * - Automatic rollback on error
 * 
 * Pattern:
 * 1. Optimistic update (instant UI)
 * 2. Background sync (database)
 * 3. Error handling (rollback)
 */

import { logger } from './logger';

export interface ElementUpdateConfig<T> {
  /** Element identifier for logging (e.g., 'likesCount', 'commentsCount') */
  elementId: string;
  
  /** Post ID being updated */
  postId: string;
  
  /** Function to update local state optimistically (returns new value) */
  optimisticUpdate: () => T;
  
  /** Function to sync with database (async) */
  backgroundSync: () => Promise<void>;
  
  /** Function to rollback optimistic update on error */
  rollback: () => void;
  
  /** Optional: Function to call on success */
  onSuccess?: () => void;
  
  /** Optional: Function to call on error */
  onError?: (error: Error) => void;
}

/**
 * Standard method to update any post element
 * 
 * This follows the pattern:
 * 1. Optimistic update (instant UI feedback)
 * 2. Background sync (database update)
 * 3. Error handling (rollback on failure)
 * 
 * @example
 * ```typescript
 * await updatePostElement({
 *   elementId: 'likesCount',
 *   postId: postId,
 *   optimisticUpdate: () => {
 *     setLikesCount(prev => prev + 1);
 *     return likesCount + 1;
 *   },
 *   backgroundSync: async () => {
 *     await client.models.PostLike.create({ postId, userId, type: 'like' });
 *     await recalculatePostCounts(postId);
 *   },
 *   rollback: () => {
 *     setLikesCount(previousLikesCount);
 *   },
 * });
 * ```
 */
export async function updatePostElement<T>(
  config: ElementUpdateConfig<T>
): Promise<T> {
  const {
    elementId,
    postId,
    optimisticUpdate,
    backgroundSync,
    rollback,
    onSuccess,
    onError,
  } = config;

  try {
    // Step 1: Optimistic update (instant UI feedback)
    logger.log(`🔄 Optimistically updating ${elementId} for post ${postId}`);
    const newValue = optimisticUpdate();

    // Step 2: Background sync (database update - non-blocking)
    try {
      await backgroundSync();
      logger.log(`✅ Successfully synced ${elementId} for post ${postId}`);
      
      // Step 3: Success callback
      if (onSuccess) {
        onSuccess();
      }
    } catch (syncError) {
      // Step 4: Rollback on sync failure
      logger.error(`❌ Failed to sync ${elementId} for post ${postId}:`, syncError);
      rollback();
      
      if (onError) {
        onError(syncError instanceof Error ? syncError : new Error(String(syncError)));
      }
      
      throw syncError;
    }

    return newValue;
  } catch (error) {
    logger.error(`❌ Failed to update ${elementId} for post ${postId}:`, error);
    
    if (onError) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
    
    throw error;
  }
}

/**
 * Batch update multiple post elements at once
 * 
 * Useful when multiple elements need to update together (e.g., like + unlike)
 */
export async function batchUpdatePostElements(
  configs: ElementUpdateConfig<unknown>[]
): Promise<void> {
  const results = await Promise.allSettled(
    configs.map(config => updatePostElement(config))
  );

  // Check if any updates failed
  const failures = results.filter(result => result.status === 'rejected');
  
  if (failures.length > 0) {
    logger.warn(`⚠️ ${failures.length} of ${configs.length} element updates failed`);
    
    // Rollback all updates if any failed
    configs.forEach(config => {
      try {
        config.rollback();
      } catch (rollbackError) {
        logger.error(`❌ Failed to rollback ${config.elementId}:`, rollbackError);
      }
    });
    
    throw new Error(`${failures.length} element updates failed`);
  }
}
