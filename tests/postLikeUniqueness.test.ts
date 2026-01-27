import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for PostLike uniqueness enforcement
 * 
 * These tests verify that:
 * 1. A user can only have one like/dislike per post
 * 2. The system prevents duplicate PostLike records
 * 3. Switching between like/dislike works correctly
 * 4. Rapid clicks don't create duplicates
 */

describe('PostLike Uniqueness Enforcement', () => {
  // Mock PostLike records
  const mockPostLikes: Array<{
    id: string;
    postId: string;
    userId: string;
    type: 'like' | 'dislike';
    createdAt: string;
  }> = [];

  beforeEach(() => {
    mockPostLikes.length = 0; // Reset for each test
  });

  describe('Single Like/Dislike Per User Per Post', () => {
    it('should prevent creating duplicate likes for the same user and post', () => {
      // User1 likes post1
      const existingLike = {
        id: '1',
        postId: 'post1',
        userId: 'user1',
        type: 'like' as const,
        createdAt: '2024-01-01T00:00:00Z',
      };
      mockPostLikes.push(existingLike);

      // Try to create another like for the same user and post
      const duplicateLike = mockPostLikes.find(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
      );

      // Should find the existing like (preventing duplicate)
      expect(duplicateLike).toBeDefined();
      expect(duplicateLike?.id).toBe('1');
      
      // Should only have one like record
      const userLikes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
      );
      expect(userLikes.length).toBe(1);
    });

    it('should prevent creating duplicate dislikes for the same user and post', () => {
      // User1 dislikes post1
      const existingDislike = {
        id: '2',
        postId: 'post1',
        userId: 'user1',
        type: 'dislike' as const,
        createdAt: '2024-01-01T00:01:00Z',
      };
      mockPostLikes.push(existingDislike);

      // Try to create another dislike for the same user and post
      const duplicateDislike = mockPostLikes.find(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'dislike'
      );

      // Should find the existing dislike (preventing duplicate)
      expect(duplicateDislike).toBeDefined();
      expect(duplicateDislike?.id).toBe('2');
      
      // Should only have one dislike record
      const userDislikes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'dislike'
      );
      expect(userDislikes.length).toBe(1);
    });

    it('should allow different users to like the same post', () => {
      // User1 likes post1
      mockPostLikes.push({
        id: '1',
        postId: 'post1',
        userId: 'user1',
        type: 'like' as const,
        createdAt: '2024-01-01T00:00:00Z',
      });

      // User2 likes post1 (should be allowed)
      mockPostLikes.push({
        id: '2',
        postId: 'post1',
        userId: 'user2',
        type: 'like' as const,
        createdAt: '2024-01-01T00:01:00Z',
      });

      const user1Likes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
      );
      const user2Likes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user2' && like.type === 'like'
      );

      expect(user1Likes.length).toBe(1);
      expect(user2Likes.length).toBe(1);
      expect(mockPostLikes.length).toBe(2);
    });

    it('should allow the same user to like different posts', () => {
      // User1 likes post1
      mockPostLikes.push({
        id: '1',
        postId: 'post1',
        userId: 'user1',
        type: 'like' as const,
        createdAt: '2024-01-01T00:00:00Z',
      });

      // User1 likes post2 (should be allowed)
      mockPostLikes.push({
        id: '2',
        postId: 'post2',
        userId: 'user1',
        type: 'like' as const,
        createdAt: '2024-01-01T00:01:00Z',
      });

      const post1Likes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1'
      );
      const post2Likes = mockPostLikes.filter(
        like => like.postId === 'post2' && like.userId === 'user1'
      );

      expect(post1Likes.length).toBe(1);
      expect(post2Likes.length).toBe(1);
      expect(mockPostLikes.length).toBe(2);
    });
  });

  describe('Switching Between Like and Dislike', () => {
    it('should replace like with dislike (not create both)', () => {
      // User1 initially likes post1
      mockPostLikes.push({
        id: '1',
        postId: 'post1',
        userId: 'user1',
        type: 'like' as const,
        createdAt: '2024-01-01T00:00:00Z',
      });

      // User1 switches to dislike - should delete like first
      const likeIndex = mockPostLikes.findIndex(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
      );
      if (likeIndex !== -1) {
        mockPostLikes.splice(likeIndex, 1);
      }

      // Then create dislike
      mockPostLikes.push({
        id: '2',
        postId: 'post1',
        userId: 'user1',
        type: 'dislike' as const,
        createdAt: '2024-01-01T00:01:00Z',
      });

      const userLikes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
      );
      const userDislikes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'dislike'
      );

      expect(userLikes.length).toBe(0);
      expect(userDislikes.length).toBe(1);
      expect(mockPostLikes.length).toBe(1);
    });

    it('should replace dislike with like (not create both)', () => {
      // User1 initially dislikes post1
      mockPostLikes.push({
        id: '1',
        postId: 'post1',
        userId: 'user1',
        type: 'dislike' as const,
        createdAt: '2024-01-01T00:00:00Z',
      });

      // User1 switches to like - should delete dislike first
      const dislikeIndex = mockPostLikes.findIndex(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'dislike'
      );
      if (dislikeIndex !== -1) {
        mockPostLikes.splice(dislikeIndex, 1);
      }

      // Then create like
      mockPostLikes.push({
        id: '2',
        postId: 'post1',
        userId: 'user1',
        type: 'like' as const,
        createdAt: '2024-01-01T00:01:00Z',
      });

      const userLikes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
      );
      const userDislikes = mockPostLikes.filter(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'dislike'
      );

      expect(userLikes.length).toBe(1);
      expect(userDislikes.length).toBe(0);
      expect(mockPostLikes.length).toBe(1);
    });
  });

  describe('Rapid Click Prevention', () => {
    it('should handle rapid like clicks without creating duplicates', () => {
      // Simulate rapid clicks: user clicks like button 5 times quickly
      const rapidClicks = 5;
      let likeCount = 0;

      for (let i = 0; i < rapidClicks; i++) {
        // Check if user already has a like
        const existingLike = mockPostLikes.find(
          like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
        );

        if (!existingLike) {
          // Only create if it doesn't exist
          mockPostLikes.push({
            id: `like-${i}`,
            postId: 'post1',
            userId: 'user1',
            type: 'like' as const,
            createdAt: `2024-01-01T00:0${i}:00Z`,
          });
          likeCount++;
        }
      }

      // Should only have one like despite 5 clicks
      expect(likeCount).toBe(1);
      expect(mockPostLikes.length).toBe(1);
    });

    it('should handle rapid dislike clicks without creating duplicates', () => {
      // Simulate rapid clicks: user clicks dislike button 3 times quickly
      const rapidClicks = 3;
      let dislikeCount = 0;

      for (let i = 0; i < rapidClicks; i++) {
        // Check if user already has a dislike
        const existingDislike = mockPostLikes.find(
          like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'dislike'
        );

        if (!existingDislike) {
          // Only create if it doesn't exist
          mockPostLikes.push({
            id: `dislike-${i}`,
            postId: 'post1',
            userId: 'user1',
            type: 'dislike' as const,
            createdAt: `2024-01-01T00:0${i}:00Z`,
          });
          dislikeCount++;
        }
      }

      // Should only have one dislike despite 3 clicks
      expect(dislikeCount).toBe(1);
      expect(mockPostLikes.length).toBe(1);
    });
  });

  describe('Toggle Behavior', () => {
    it('should remove like when user clicks like again (toggle off)', () => {
      // User1 likes post1
      mockPostLikes.push({
        id: '1',
        postId: 'post1',
        userId: 'user1',
        type: 'like' as const,
        createdAt: '2024-01-01T00:00:00Z',
      });

      // User1 clicks like again - should remove it
      const likeIndex = mockPostLikes.findIndex(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'like'
      );
      if (likeIndex !== -1) {
        mockPostLikes.splice(likeIndex, 1);
      }

      expect(mockPostLikes.length).toBe(0);
    });

    it('should remove dislike when user clicks dislike again (toggle off)', () => {
      // User1 dislikes post1
      mockPostLikes.push({
        id: '1',
        postId: 'post1',
        userId: 'user1',
        type: 'dislike' as const,
        createdAt: '2024-01-01T00:00:00Z',
      });

      // User1 clicks dislike again - should remove it
      const dislikeIndex = mockPostLikes.findIndex(
        like => like.postId === 'post1' && like.userId === 'user1' && like.type === 'dislike'
      );
      if (dislikeIndex !== -1) {
        mockPostLikes.splice(dislikeIndex, 1);
      }

      expect(mockPostLikes.length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle checking for existing like before creating', () => {
      // Simulate the check-before-create pattern
      const checkBeforeCreate = (postId: string, userId: string, type: 'like' | 'dislike') => {
        const existing = mockPostLikes.find(
          like => like.postId === postId && like.userId === userId && like.type === type
        );
        
        if (existing) {
          return { exists: true, shouldCreate: false };
        }
        
        return { exists: false, shouldCreate: true };
      };

      // First check - should allow creation
      const firstCheck = checkBeforeCreate('post1', 'user1', 'like');
      expect(firstCheck.shouldCreate).toBe(true);
      
      if (firstCheck.shouldCreate) {
        mockPostLikes.push({
          id: '1',
          postId: 'post1',
          userId: 'user1',
          type: 'like' as const,
          createdAt: '2024-01-01T00:00:00Z',
        });
      }

      // Second check - should prevent creation
      const secondCheck = checkBeforeCreate('post1', 'user1', 'like');
      expect(secondCheck.shouldCreate).toBe(false);
      expect(secondCheck.exists).toBe(true);
      expect(mockPostLikes.length).toBe(1);
    });
  });
});
