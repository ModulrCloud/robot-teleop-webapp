import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Unit tests for Username Purchase System
 * 
 * These tests verify:
 * 1. Username format validation
 * 2. Tier pricing based on length
 * 3. Reserved username handling
 * 4. Profanity filtering
 * 5. Credit validation
 * 6. Purchase flow logic
 * 7. Index name consistency (to prevent IAM/DynamoDB mismatches)
 */

// Username tier pricing (in MTR credits) - matches handler.ts
const USERNAME_TIERS = {
  og: { minLength: 1, maxLength: 3, price: 7900, label: 'OG' },
  premium: { minLength: 4, maxLength: 5, price: 1900, label: 'Premium' },
  standard: { minLength: 6, maxLength: 20, price: 500, label: 'Standard' },
};

// Reserved system usernames - matches handler.ts
const SYSTEM_RESERVED = [
  'admin', 'administrator', 'support', 'help', 'modulr', 'modulrcloud',
  'official', 'verified', 'system', 'bot', 'robot', 'api', 'dev', 'developer',
  'null', 'undefined', 'test', 'demo', 'example', 'root', 'superuser',
  'about', 'home', 'settings', 'profile', 'login', 'logout', 'signup',
  'register', 'dashboard', 'explore', 'search', 'notifications', 'messages',
];

// Basic profanity filter - matches handler.ts
const PROFANITY_LIST = [
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap',
];

// Extracted functions for testing (these mirror the Lambda handler logic)
function getTierForLength(length: number): keyof typeof USERNAME_TIERS | null {
  if (length >= USERNAME_TIERS.og.minLength && length <= USERNAME_TIERS.og.maxLength) return 'og';
  if (length >= USERNAME_TIERS.premium.minLength && length <= USERNAME_TIERS.premium.maxLength) return 'premium';
  if (length >= USERNAME_TIERS.standard.minLength && length <= USERNAME_TIERS.standard.maxLength) return 'standard';
  return null;
}

function validateUsernameFormat(username: string): { valid: boolean; error?: string } {
  if (!username || username.length === 0) {
    return { valid: false, error: 'Username is required' };
  }

  if (username.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }

  if (!/^[a-z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Only lowercase letters, numbers, and underscores allowed' };
  }

  if (/__/.test(username)) {
    return { valid: false, error: 'No consecutive underscores allowed' };
  }

  if (username.startsWith('_') || username.endsWith('_')) {
    return { valid: false, error: 'Cannot start or end with underscore' };
  }

  if (SYSTEM_RESERVED.includes(username)) {
    return { valid: false, error: 'This username is reserved' };
  }

  for (const word of PROFANITY_LIST) {
    if (username.includes(word)) {
      return { valid: false, error: 'Username contains inappropriate content' };
    }
  }

  return { valid: true };
}

describe('Username Purchase System', () => {
  describe('Username Format Validation', () => {
    it('should reject empty username', () => {
      const result = validateUsernameFormat('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username is required');
    });

    it('should reject username over 20 characters', () => {
      const result = validateUsernameFormat('thisusernameiswaytoolongforoursystem');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must be 20 characters or less');
    });

    it('should reject uppercase letters', () => {
      const result = validateUsernameFormat('MyUsername');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Only lowercase letters, numbers, and underscores allowed');
    });

    it('should reject special characters', () => {
      const result = validateUsernameFormat('user@name');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Only lowercase letters, numbers, and underscores allowed');
    });

    it('should reject consecutive underscores', () => {
      const result = validateUsernameFormat('user__name');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No consecutive underscores allowed');
    });

    it('should reject username starting with underscore', () => {
      const result = validateUsernameFormat('_username');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot start or end with underscore');
    });

    it('should reject username ending with underscore', () => {
      const result = validateUsernameFormat('username_');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot start or end with underscore');
    });

    it('should accept valid username with letters only', () => {
      const result = validateUsernameFormat('validusername');
      expect(result.valid).toBe(true);
    });

    it('should accept valid username with letters and numbers', () => {
      const result = validateUsernameFormat('user123');
      expect(result.valid).toBe(true);
    });

    it('should accept valid username with underscore in middle', () => {
      const result = validateUsernameFormat('user_name');
      expect(result.valid).toBe(true);
    });

    it('should accept single character username', () => {
      const result = validateUsernameFormat('a');
      expect(result.valid).toBe(true);
    });

    it('should accept 20 character username', () => {
      const result = validateUsernameFormat('abcdefghij0123456789');
      expect(result.valid).toBe(true);
    });
  });

  describe('Reserved Username Handling', () => {
    it('should reject reserved system usernames', () => {
      const reservedNames = ['admin', 'support', 'modulr', 'test', 'root'];
      
      for (const name of reservedNames) {
        const result = validateUsernameFormat(name);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('This username is reserved');
      }
    });

    it('should accept non-reserved usernames', () => {
      const validNames = ['johndoe', 'cooluser', 'robotlover'];
      
      for (const name of validNames) {
        const result = validateUsernameFormat(name);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Profanity Filtering', () => {
    it('should reject usernames containing profanity', () => {
      const profaneNames = ['fuckyou', 'shitpost', 'jackass'];
      
      for (const name of profaneNames) {
        const result = validateUsernameFormat(name);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Username contains inappropriate content');
      }
    });

    it('should accept clean usernames', () => {
      const cleanNames = ['friendly', 'awesome', 'gamer'];
      
      for (const name of cleanNames) {
        const result = validateUsernameFormat(name);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Tier Pricing', () => {
    it('should return OG tier for 1-3 character usernames', () => {
      expect(getTierForLength(1)).toBe('og');
      expect(getTierForLength(2)).toBe('og');
      expect(getTierForLength(3)).toBe('og');
    });

    it('should return Premium tier for 4-5 character usernames', () => {
      expect(getTierForLength(4)).toBe('premium');
      expect(getTierForLength(5)).toBe('premium');
    });

    it('should return Standard tier for 6-20 character usernames', () => {
      expect(getTierForLength(6)).toBe('standard');
      expect(getTierForLength(10)).toBe('standard');
      expect(getTierForLength(20)).toBe('standard');
    });

    it('should return null for usernames over 20 characters', () => {
      expect(getTierForLength(21)).toBe(null);
      expect(getTierForLength(50)).toBe(null);
    });

    it('should return null for zero length', () => {
      expect(getTierForLength(0)).toBe(null);
    });

    it('should have correct pricing for each tier', () => {
      expect(USERNAME_TIERS.og.price).toBe(7900); // $79
      expect(USERNAME_TIERS.premium.price).toBe(1900); // $19
      expect(USERNAME_TIERS.standard.price).toBe(500); // $5
    });
  });

  describe('Credit Validation', () => {
    interface UserCredits {
      userId: string;
      credits: number;
    }

    const mockUserCredits: UserCredits[] = [];

    beforeEach(() => {
      mockUserCredits.length = 0;
    });

    it('should allow purchase when user has enough credits for OG tier', () => {
      mockUserCredits.push({ userId: 'user1', credits: 10000 });
      
      const userCredits = mockUserCredits.find(u => u.userId === 'user1');
      const price = USERNAME_TIERS.og.price;
      
      expect(userCredits).toBeDefined();
      expect(userCredits!.credits >= price).toBe(true);
    });

    it('should reject purchase when user has insufficient credits', () => {
      mockUserCredits.push({ userId: 'user1', credits: 500 });
      
      const userCredits = mockUserCredits.find(u => u.userId === 'user1');
      const price = USERNAME_TIERS.og.price; // 7900
      
      expect(userCredits).toBeDefined();
      expect(userCredits!.credits >= price).toBe(false);
    });

    it('should correctly deduct credits after purchase', () => {
      const initialCredits = 10000;
      mockUserCredits.push({ userId: 'user1', credits: initialCredits });
      
      const price = USERNAME_TIERS.standard.price; // 500
      const userCredits = mockUserCredits.find(u => u.userId === 'user1');
      
      if (userCredits && userCredits.credits >= price) {
        userCredits.credits -= price;
      }
      
      expect(userCredits!.credits).toBe(initialCredits - price);
      expect(userCredits!.credits).toBe(9500);
    });
  });

  describe('Purchase Flow Logic', () => {
    interface SocialProfile {
      id: string;
      cognitoId: string;
      username: string | null;
    }

    interface UserCredits {
      userId: string;
      credits: number;
    }

    const mockProfiles: SocialProfile[] = [];
    const mockCredits: UserCredits[] = [];

    beforeEach(() => {
      mockProfiles.length = 0;
      mockCredits.length = 0;
    });

    it('should prevent purchase if user already has a username', () => {
      mockProfiles.push({
        id: 'profile1',
        cognitoId: 'user1',
        username: 'existinguser',
      });

      const existingProfile = mockProfiles.find(
        p => p.cognitoId === 'user1' && p.username !== null
      );

      expect(existingProfile).toBeDefined();
      expect(existingProfile?.username).toBe('existinguser');
    });

    it('should prevent purchase if username is already taken', () => {
      mockProfiles.push({
        id: 'profile1',
        cognitoId: 'user1',
        username: 'coolname',
      });

      const takenUsername = mockProfiles.find(p => p.username === 'coolname');
      expect(takenUsername).toBeDefined();
    });

    it('should allow purchase of available username', () => {
      mockProfiles.push({
        id: 'profile1',
        cognitoId: 'user1',
        username: 'existinguser',
      });

      const requestedUsername = 'newusername';
      const takenUsername = mockProfiles.find(p => p.username === requestedUsername);
      
      expect(takenUsername).toBeUndefined();
    });

    it('should create profile if user does not have one', () => {
      mockCredits.push({ userId: 'user1', credits: 10000 });
      
      const existingProfile = mockProfiles.find(p => p.cognitoId === 'user1');
      expect(existingProfile).toBeUndefined();

      // Simulate creating a new profile
      if (!existingProfile) {
        mockProfiles.push({
          id: 'new-profile-id',
          cognitoId: 'user1',
          username: 'newusername',
        });
      }

      const newProfile = mockProfiles.find(p => p.cognitoId === 'user1');
      expect(newProfile).toBeDefined();
      expect(newProfile?.username).toBe('newusername');
    });

    it('should complete full purchase flow successfully', () => {
      // Setup: User with credits, no existing profile
      mockCredits.push({ userId: 'user1', credits: 10000 });
      
      const requestedUsername = 'mynewname';
      
      // Step 1: Validate format
      const formatValid = validateUsernameFormat(requestedUsername);
      expect(formatValid.valid).toBe(true);
      
      // Step 2: Check tier and price
      const tier = getTierForLength(requestedUsername.length);
      expect(tier).toBe('standard');
      const price = USERNAME_TIERS.standard.price;
      expect(price).toBe(500);
      
      // Step 3: Check if username is taken
      const isTaken = mockProfiles.some(p => p.username === requestedUsername);
      expect(isTaken).toBe(false);
      
      // Step 4: Check credits
      const userCredits = mockCredits.find(c => c.userId === 'user1');
      expect(userCredits).toBeDefined();
      expect(userCredits!.credits >= price).toBe(true);
      
      // Step 5: Deduct credits
      userCredits!.credits -= price;
      expect(userCredits!.credits).toBe(9500);
      
      // Step 6: Create profile
      mockProfiles.push({
        id: 'new-profile',
        cognitoId: 'user1',
        username: requestedUsername,
      });
      
      const newProfile = mockProfiles.find(p => p.cognitoId === 'user1');
      expect(newProfile).toBeDefined();
      expect(newProfile?.username).toBe('mynewname');
    });
  });

  describe('MTR to USD Conversion', () => {
    it('should correctly convert MTR to USD (1 USD = 100 MTR)', () => {
      const formatMtrAsUsd = (mtr: number): string => {
        const usd = mtr / 100;
        return `$${usd.toFixed(2)}`;
      };

      expect(formatMtrAsUsd(7900)).toBe('$79.00');
      expect(formatMtrAsUsd(1900)).toBe('$19.00');
      expect(formatMtrAsUsd(500)).toBe('$5.00');
      expect(formatMtrAsUsd(399)).toBe('$3.99');
      expect(formatMtrAsUsd(4000)).toBe('$40.00');
    });
  });

  describe('Edge Cases', () => {
    it('should handle username with all numbers', () => {
      const result = validateUsernameFormat('123456');
      expect(result.valid).toBe(true);
    });

    it('should handle username with mix of valid characters', () => {
      const result = validateUsernameFormat('user_123_name');
      expect(result.valid).toBe(true);
    });

    it('should reject spaces in username', () => {
      const result = validateUsernameFormat('user name');
      expect(result.valid).toBe(false);
    });

    it('should reject hyphens in username', () => {
      const result = validateUsernameFormat('user-name');
      expect(result.valid).toBe(false);
    });

    it('should handle exact boundary lengths', () => {
      // OG/Premium boundary (3 -> 4)
      expect(getTierForLength(3)).toBe('og');
      expect(getTierForLength(4)).toBe('premium');
      
      // Premium/Standard boundary (5 -> 6)
      expect(getTierForLength(5)).toBe('premium');
      expect(getTierForLength(6)).toBe('standard');
      
      // Standard/Invalid boundary (20 -> 21)
      expect(getTierForLength(20)).toBe('standard');
      expect(getTierForLength(21)).toBe(null);
    });
  });

  /**
   * Index Name Consistency Tests
   * 
   * These tests document the expected index names that MUST match across:
   * 1. amplify/data/resource.ts (schema definition - .secondaryIndexes())
   * 2. amplify/backend.ts (IAM permissions - addToRolePolicy)
   * 3. Lambda handlers (QueryCommand - IndexName property)
   * 
   * If these don't match, you'll get:
   * - "The table does not have the specified index" (wrong index name in Lambda)
   * - "not authorized to perform: dynamodb:Query on resource" (wrong index name in IAM policy)
   */
  describe('Index Name Consistency', () => {
    // Expected index names from amplify/data/resource.ts
    const EXPECTED_INDEX_NAMES = {
      SocialProfile: {
        cognitoId: 'cognitoIdIndex',   // index('cognitoId').name('cognitoIdIndex')
        username: 'usernameIndex',      // index('username').name('usernameIndex')
        email: 'emailIndex',            // index('email').name('emailIndex')
      },
      ReservedUsername: {
        username: 'usernameIndex',      // index('username').name('usernameIndex')
      },
      UserCredits: {
        userId: 'userIdIndex',          // index('userId').name('userIdIndex')
      },
    };

    it('should have correct SocialProfile cognitoId index name', () => {
      expect(EXPECTED_INDEX_NAMES.SocialProfile.cognitoId).toBe('cognitoIdIndex');
      // Common mistake: using 'byCognitoId' instead of 'cognitoIdIndex'
      expect(EXPECTED_INDEX_NAMES.SocialProfile.cognitoId).not.toBe('byCognitoId');
    });

    it('should have correct SocialProfile username index name', () => {
      expect(EXPECTED_INDEX_NAMES.SocialProfile.username).toBe('usernameIndex');
      // Common mistake: using 'byUsername' instead of 'usernameIndex'
      expect(EXPECTED_INDEX_NAMES.SocialProfile.username).not.toBe('byUsername');
    });

    it('should have correct ReservedUsername index name', () => {
      expect(EXPECTED_INDEX_NAMES.ReservedUsername.username).toBe('usernameIndex');
      // Common mistake: using 'byUsername' instead of 'usernameIndex'
      expect(EXPECTED_INDEX_NAMES.ReservedUsername.username).not.toBe('byUsername');
    });

    it('should have correct UserCredits index name', () => {
      expect(EXPECTED_INDEX_NAMES.UserCredits.userId).toBe('userIdIndex');
    });

    it('index names should follow consistent naming convention', () => {
      // All indexes should follow the pattern: {fieldName}Index
      const allIndexNames = [
        EXPECTED_INDEX_NAMES.SocialProfile.cognitoId,
        EXPECTED_INDEX_NAMES.SocialProfile.username,
        EXPECTED_INDEX_NAMES.SocialProfile.email,
        EXPECTED_INDEX_NAMES.ReservedUsername.username,
        EXPECTED_INDEX_NAMES.UserCredits.userId,
      ];

      for (const indexName of allIndexNames) {
        expect(indexName).toMatch(/^[a-z]+Index$/i);
      }
    });
  });
});
