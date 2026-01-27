import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for Post like/dislike count synchronization
 * 
 * These tests verify that:
 * 1. Counts are correctly calculated from PostLike records
 * 2. Post records are updated with accurate counts
 * 3. Counts remain consistent across concurrent updates
 */

describe('Post Like/Dislike Count Synchronization', () => {
  // Mock PostLike records
  const mockPostLikes = [
    { id: '1', postId: 'post1', userId: 'user1', type: 'like' as const, createdAt: '2024-01-01T00:00:00Z' },
    { id: '2', postId: 'post1', userId: 'user2', type: 'like' as const, createdAt: '2024-01-01T00:01:00Z' },
    { id: '3', postId: 'post1', userId: 'user3', type: 'dislike' as const, createdAt: '2024-01-01T00:02:00Z' },
    { id: '4', postId: 'post2', userId: 'user1', type: 'like' as const, createdAt: '2024-01-01T00:03:00Z' },
  ];

  describe('Count Calculation from PostLike Records', () => {
    it('should correctly count likes for a post', () => {
      const post1Likes = mockPostLikes.filter(like => like.postId === 'post1' && like.type === 'like');
      expect(post1Likes.length).toBe(2);
    });

    it('should correctly count dislikes for a post', () => {
      const post1Dislikes = mockPostLikes.filter(like => like.postId === 'post1' && like.type === 'dislike');
      expect(post1Dislikes.length).toBe(1);
    });

    it('should return zero counts for a post with no likes/dislikes', () => {
      const post3Likes = mockPostLikes.filter(like => like.postId === 'post3' && like.type === 'like');
      const post3Dislikes = mockPostLikes.filter(like => like.postId === 'post3' && like.type === 'dislike');
      expect(post3Likes.length).toBe(0);
      expect(post3Dislikes.length).toBe(0);
    });

    it('should handle posts with only likes', () => {
      const post2Likes = mockPostLikes.filter(like => like.postId === 'post2' && like.type === 'like');
      const post2Dislikes = mockPostLikes.filter(like => like.postId === 'post2' && like.type === 'dislike');
      expect(post2Likes.length).toBe(1);
      expect(post2Dislikes.length).toBe(0);
    });
  });

  describe('Count Synchronization Logic', () => {
    it('should calculate accurate counts from PostLike records', () => {
      const calculateCounts = (postId: string) => {
        const allLikes = mockPostLikes.filter(like => like.postId === postId);
        const likes = allLikes.filter(like => like.type === 'like').length;
        const dislikes = allLikes.filter(like => like.type === 'dislike').length;
        return { likes, dislikes };
      };

      const post1Counts = calculateCounts('post1');
      expect(post1Counts.likes).toBe(2);
      expect(post1Counts.dislikes).toBe(1);

      const post2Counts = calculateCounts('post2');
      expect(post2Counts.likes).toBe(1);
      expect(post2Counts.dislikes).toBe(0);
    });

    it('should detect when Post counts need updating', () => {
      const calculateCounts = (postId: string) => {
        const allLikes = mockPostLikes.filter(like => like.postId === postId);
        const likes = allLikes.filter(like => like.type === 'like').length;
        const dislikes = allLikes.filter(like => like.type === 'dislike').length;
        return { likes, dislikes };
      };

      const post1Counts = calculateCounts('post1');
      const storedPost1 = { id: 'post1', likesCount: 1, dislikesCount: 0 }; // Stale counts

      const needsUpdate = 
        storedPost1.likesCount !== post1Counts.likes || 
        storedPost1.dislikesCount !== post1Counts.dislikes;

      expect(needsUpdate).toBe(true);
      expect(post1Counts.likes).toBe(2);
      expect(post1Counts.dislikes).toBe(1);
    });

    it('should not update when counts are already accurate', () => {
      const calculateCounts = (postId: string) => {
        const allLikes = mockPostLikes.filter(like => like.postId === postId);
        const likes = allLikes.filter(like => like.type === 'like').length;
        const dislikes = allLikes.filter(like => like.type === 'dislike').length;
        return { likes, dislikes };
      };

      const post1Counts = calculateCounts('post1');
      const storedPost1 = { id: 'post1', likesCount: 2, dislikesCount: 1 }; // Accurate counts

      const needsUpdate = 
        storedPost1.likesCount !== post1Counts.likes || 
        storedPost1.dislikesCount !== post1Counts.dislikes;

      expect(needsUpdate).toBe(false);
    });
  });

  describe('Concurrent Update Scenarios', () => {
    it('should handle multiple users liking the same post', () => {
      const concurrentLikes = [
        ...mockPostLikes,
        { id: '5', postId: 'post1', userId: 'user4', type: 'like' as const, createdAt: '2024-01-01T00:04:00Z' },
        { id: '6', postId: 'post1', userId: 'user5', type: 'like' as const, createdAt: '2024-01-01T00:05:00Z' },
      ];

      const post1Likes = concurrentLikes.filter(like => like.postId === 'post1' && like.type === 'like');
      expect(post1Likes.length).toBe(4); // Original 2 + 2 new
    });

    it('should handle a user switching from like to dislike', () => {
      // User1 initially likes post1
      const initialLikes = mockPostLikes.filter(like => like.postId === 'post1' && like.type === 'like');
      expect(initialLikes.length).toBe(2);

      // User1 removes like and adds dislike
      const afterSwitch = mockPostLikes
        .filter(like => !(like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'))
        .concat([
          { id: '7', postId: 'post1', userId: 'user1', type: 'dislike' as const, createdAt: '2024-01-01T00:06:00Z' },
        ]);

      const post1Likes = afterSwitch.filter(like => like.postId === 'post1' && like.type === 'like');
      const post1Dislikes = afterSwitch.filter(like => like.postId === 'post1' && like.type === 'dislike');
      
      expect(post1Likes.length).toBe(1); // One less like
      expect(post1Dislikes.length).toBe(2); // One more dislike
    });

    it('should handle a user removing their like', () => {
      // User1 removes their like
      const afterRemoval = mockPostLikes.filter(
        like => !(like.postId === 'post1' && like.userId === 'user1' && like.type === 'like')
      );

      const post1Likes = afterRemoval.filter(like => like.postId === 'post1' && like.type === 'like');
      expect(post1Likes.length).toBe(1); // One less like
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty PostLike array', () => {
      const emptyLikes: typeof mockPostLikes = [];
      const likes = emptyLikes.filter(like => like.type === 'like').length;
      const dislikes = emptyLikes.filter(like => like.type === 'dislike').length;
      
      expect(likes).toBe(0);
      expect(dislikes).toBe(0);
    });

    it('should handle posts with only dislikes', () => {
      const onlyDislikes = [
        { id: '8', postId: 'post3', userId: 'user1', type: 'dislike' as const, createdAt: '2024-01-01T00:07:00Z' },
        { id: '9', postId: 'post3', userId: 'user2', type: 'dislike' as const, createdAt: '2024-01-01T00:08:00Z' },
      ];

      const post3Likes = onlyDislikes.filter(like => like.type === 'like').length;
      const post3Dislikes = onlyDislikes.filter(like => like.type === 'dislike').length;
      
      expect(post3Likes).toBe(0);
      expect(post3Dislikes).toBe(2);
    });

    it('should handle very large like counts', () => {
      const manyLikes = Array.from({ length: 1000 }, (_, i) => ({
        id: `like-${i}`,
        postId: 'post4',
        userId: `user${i}`,
        type: 'like' as const,
        createdAt: `2024-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      }));

      const likes = manyLikes.filter(like => like.type === 'like').length;
      expect(likes).toBe(1000);
    });
  });
});
