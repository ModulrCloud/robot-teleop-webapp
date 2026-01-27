import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Unit tests for Content Gating System
 * 
 * These tests verify:
 * 1. Gating logic for posts and comments (requires username)
 * 2. useSocialProfile derived values (hasUsername, isProUser, etc.)
 * 3. Content creation permission flow
 * 4. Edge cases for profile states
 */

// Types matching the actual SocialProfile schema
interface SocialProfile {
  id: string;
  cognitoId: string;
  email?: string | null;
  username?: string | null;
  displayName?: string | null;
  subscriptionStatus?: string | null; // 'none' | 'trial' | 'active' | 'cancelled' | 'expired'
  subscriptionPlan?: string | null;
  trialEndsAt?: string | null;
  moderationStatus?: string | null;
}

// Types for the derived values from useSocialProfile hook
interface SocialProfileDerivedValues {
  profile: SocialProfile | null;
  username: string | null;
  displayName: string | null;
  hasUsername: boolean;
  subscriptionStatus: string | null;
  isProUser: boolean;
}

/**
 * Mirrors the derived values logic in useSocialProfile.ts
 * This is the core gating logic used throughout the app
 */
function deriveSocialProfileValues(profile: SocialProfile | null): SocialProfileDerivedValues {
  const username = profile?.username || null;
  const displayName = profile?.displayName || null;
  const hasUsername = !!username;
  const subscriptionStatus = profile?.subscriptionStatus || null;
  const isProUser = subscriptionStatus === 'trial' || subscriptionStatus === 'active';

  return {
    profile,
    username,
    displayName,
    hasUsername,
    subscriptionStatus,
    isProUser,
  };
}

/**
 * Gating check for content creation (posts and comments)
 * Mirrors the logic in CreatePostModal.tsx and CommentModal.tsx
 */
function canCreateContent(profileValues: SocialProfileDerivedValues): {
  allowed: boolean;
  reason?: string;
} {
  if (!profileValues.hasUsername || !profileValues.username) {
    return {
      allowed: false,
      reason: 'Username registration required',
    };
  }

  return { allowed: true };
}

/**
 * Determines what username to display on posts/comments
 * Mirrors the logic used when creating posts
 */
function getDisplayUsername(profileValues: SocialProfileDerivedValues): string | null {
  if (!profileValues.hasUsername) {
    return null;
  }
  return `@${profileValues.username}`;
}

describe('Content Gating System', () => {
  describe('useSocialProfile Derived Values', () => {
    it('should set hasUsername to false when profile is null', () => {
      const values = deriveSocialProfileValues(null);
      
      expect(values.profile).toBeNull();
      expect(values.username).toBeNull();
      expect(values.hasUsername).toBe(false);
    });

    it('should set hasUsername to false when profile has no username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        email: 'user@example.com',
        username: null,
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.profile).toBe(profile);
      expect(values.username).toBeNull();
      expect(values.hasUsername).toBe(false);
    });

    it('should set hasUsername to false when profile has empty string username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: '',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.username).toBeNull(); // '' || null = null
      expect(values.hasUsername).toBe(false);
    });

    it('should set hasUsername to true when profile has a username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.username).toBe('testuser');
      expect(values.hasUsername).toBe(true);
    });

    it('should derive displayName correctly', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        displayName: 'Test User 🚀',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.displayName).toBe('Test User 🚀');
    });

    it('should set displayName to null when not set', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.displayName).toBeNull();
    });
  });

  describe('Subscription Status Derivation', () => {
    it('should set isProUser to false when subscriptionStatus is null', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        subscriptionStatus: null,
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.subscriptionStatus).toBeNull();
      expect(values.isProUser).toBe(false);
    });

    it('should set isProUser to false when subscriptionStatus is "none"', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        subscriptionStatus: 'none',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.subscriptionStatus).toBe('none');
      expect(values.isProUser).toBe(false);
    });

    it('should set isProUser to true when subscriptionStatus is "trial"', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        subscriptionStatus: 'trial',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.subscriptionStatus).toBe('trial');
      expect(values.isProUser).toBe(true);
    });

    it('should set isProUser to true when subscriptionStatus is "active"', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        subscriptionStatus: 'active',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.subscriptionStatus).toBe('active');
      expect(values.isProUser).toBe(true);
    });

    it('should set isProUser to false when subscriptionStatus is "cancelled"', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        subscriptionStatus: 'cancelled',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.subscriptionStatus).toBe('cancelled');
      expect(values.isProUser).toBe(false);
    });

    it('should set isProUser to false when subscriptionStatus is "expired"', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        subscriptionStatus: 'expired',
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.subscriptionStatus).toBe('expired');
      expect(values.isProUser).toBe(false);
    });
  });

  describe('Post Creation Gating', () => {
    it('should block post creation when user has no profile', () => {
      const values = deriveSocialProfileValues(null);
      const result = canCreateContent(values);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Username registration required');
    });

    it('should block post creation when user has profile but no username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        email: 'user@example.com',
        username: null,
      };
      
      const values = deriveSocialProfileValues(profile);
      const result = canCreateContent(values);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Username registration required');
    });

    it('should allow post creation when user has a username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
      };
      
      const values = deriveSocialProfileValues(profile);
      const result = canCreateContent(values);
      
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow post creation regardless of subscription status', () => {
      // Free user with username
      const freeProfile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'freeuser',
        subscriptionStatus: 'none',
      };
      
      const freeValues = deriveSocialProfileValues(freeProfile);
      expect(canCreateContent(freeValues).allowed).toBe(true);
      
      // Pro user with username
      const proProfile: SocialProfile = {
        id: 'profile-456',
        cognitoId: 'google_987654321',
        username: 'prouser',
        subscriptionStatus: 'active',
      };
      
      const proValues = deriveSocialProfileValues(proProfile);
      expect(canCreateContent(proValues).allowed).toBe(true);
    });
  });

  describe('Comment Creation Gating', () => {
    // Comment gating uses the same logic as post gating
    it('should block comment creation when user has no username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: null,
      };
      
      const values = deriveSocialProfileValues(profile);
      const result = canCreateContent(values);
      
      expect(result.allowed).toBe(false);
    });

    it('should allow comment creation when user has a username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'commenter',
      };
      
      const values = deriveSocialProfileValues(profile);
      const result = canCreateContent(values);
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('Display Username Formatting', () => {
    it('should return null when user has no username', () => {
      const values = deriveSocialProfileValues(null);
      const displayUsername = getDisplayUsername(values);
      
      expect(displayUsername).toBeNull();
    });

    it('should return @username format when user has a username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
      };
      
      const values = deriveSocialProfileValues(profile);
      const displayUsername = getDisplayUsername(values);
      
      expect(displayUsername).toBe('@testuser');
    });

    it('should handle various username formats correctly', () => {
      const testCases = [
        { username: 'simple', expected: '@simple' },
        { username: 'user_123', expected: '@user_123' },
        { username: 'a', expected: '@a' },
        { username: 'longusernamehere', expected: '@longusernamehere' },
      ];

      for (const { username, expected } of testCases) {
        const profile: SocialProfile = {
          id: `profile-${username}`,
          cognitoId: 'google_123456789',
          username,
        };
        
        const values = deriveSocialProfileValues(profile);
        expect(getDisplayUsername(values)).toBe(expected);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined username in profile', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        // username is undefined (not set)
      };
      
      const values = deriveSocialProfileValues(profile);
      
      expect(values.username).toBeNull();
      expect(values.hasUsername).toBe(false);
    });

    it('should handle profile with only required fields', () => {
      const minimalProfile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
      };
      
      const values = deriveSocialProfileValues(minimalProfile);
      
      expect(values.username).toBeNull();
      expect(values.displayName).toBeNull();
      expect(values.hasUsername).toBe(false);
      expect(values.subscriptionStatus).toBeNull();
      expect(values.isProUser).toBe(false);
    });

    it('should handle profile with all fields populated', () => {
      const fullProfile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        email: 'user@example.com',
        username: 'poweruser',
        displayName: 'Power User 💪',
        subscriptionStatus: 'active',
        subscriptionPlan: 'annual',
        trialEndsAt: null,
        moderationStatus: 'active',
      };
      
      const values = deriveSocialProfileValues(fullProfile);
      
      expect(values.username).toBe('poweruser');
      expect(values.displayName).toBe('Power User 💪');
      expect(values.hasUsername).toBe(true);
      expect(values.subscriptionStatus).toBe('active');
      expect(values.isProUser).toBe(true);
    });
  });

  describe('Gating State Transitions', () => {
    let mockProfile: SocialProfile | null;

    beforeEach(() => {
      mockProfile = null;
    });

    it('should reflect state change when user registers a username', () => {
      // Initial state: No profile
      let values = deriveSocialProfileValues(mockProfile);
      expect(canCreateContent(values).allowed).toBe(false);
      
      // User creates profile without username
      mockProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: null,
      };
      values = deriveSocialProfileValues(mockProfile);
      expect(canCreateContent(values).allowed).toBe(false);
      
      // User registers username
      mockProfile = {
        ...mockProfile,
        username: 'newuser',
      };
      values = deriveSocialProfileValues(mockProfile);
      expect(canCreateContent(values).allowed).toBe(true);
    });

    it('should reflect state change when user upgrades subscription', () => {
      mockProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'testuser',
        subscriptionStatus: 'none',
      };
      
      // Free user
      let values = deriveSocialProfileValues(mockProfile);
      expect(values.isProUser).toBe(false);
      expect(canCreateContent(values).allowed).toBe(true); // Still can post
      
      // User starts trial
      mockProfile = { ...mockProfile, subscriptionStatus: 'trial' };
      values = deriveSocialProfileValues(mockProfile);
      expect(values.isProUser).toBe(true);
      expect(canCreateContent(values).allowed).toBe(true);
      
      // User subscribes
      mockProfile = { ...mockProfile, subscriptionStatus: 'active' };
      values = deriveSocialProfileValues(mockProfile);
      expect(values.isProUser).toBe(true);
      
      // Subscription expires
      mockProfile = { ...mockProfile, subscriptionStatus: 'expired' };
      values = deriveSocialProfileValues(mockProfile);
      expect(values.isProUser).toBe(false);
      expect(canCreateContent(values).allowed).toBe(true); // Still can post (has username)
    });
  });

  describe('Modal Trigger Logic', () => {
    /**
     * This test documents the expected behavior:
     * When a user without a username tries to create content,
     * the UsernameRegistrationModal should be shown
     */
    it('should trigger username modal when gating blocks content creation', () => {
      const profileWithoutUsername: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: null,
      };
      
      const values = deriveSocialProfileValues(profileWithoutUsername);
      const gatingResult = canCreateContent(values);
      
      // In the actual component, this condition triggers setShowUsernameModal(true)
      const shouldShowUsernameModal = !gatingResult.allowed;
      
      expect(shouldShowUsernameModal).toBe(true);
    });

    it('should not trigger username modal when user has username', () => {
      const profileWithUsername: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        username: 'validuser',
      };
      
      const values = deriveSocialProfileValues(profileWithUsername);
      const gatingResult = canCreateContent(values);
      
      const shouldShowUsernameModal = !gatingResult.allowed;
      
      expect(shouldShowUsernameModal).toBe(false);
    });
  });

  describe('Post Author Display', () => {
    /**
     * Tests for how post authors are displayed
     * Posts should show @username, not Cognito ID or email
     */
    it('should format post author as @username', () => {
      const profile: SocialProfile = {
        id: 'profile-123',
        cognitoId: 'google_123456789',
        email: 'user@example.com',
        username: 'postauthor',
      };
      
      const values = deriveSocialProfileValues(profile);
      const authorDisplay = getDisplayUsername(values);
      
      // Should NOT be the Cognito ID
      expect(authorDisplay).not.toBe('google_123456789');
      // Should NOT be the email
      expect(authorDisplay).not.toBe('user@example.com');
      // Should be the @username
      expect(authorDisplay).toBe('@postauthor');
    });
  });
});
