import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { useAuthStatus } from './useAuthStatus';
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

// Type for the SocialProfile from the schema
type SocialProfile = Schema['SocialProfile']['type'];

interface SocialProfileData {
  profile: SocialProfile | null;
  username: string | null;           // @username (null if not registered)
  displayName: string | null;        // Display name (emoji allowed)
  hasUsername: boolean;              // Quick check for gating
  subscriptionStatus: string | null; // 'none' | 'trial' | 'active' | 'cancelled' | 'expired'
  isProUser: boolean;                // true if trial or active subscription
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage the current user's social profile
 * Used for:
 * - Gating post/comment creation (requires username)
 * - Displaying @username instead of Cognito ID
 * - Checking subscription status for feature limits
 */
export function useSocialProfile(): SocialProfileData {
  const { user } = useAuthStatus();
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!user?.username) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use Lambda to fetch profile (bypasses Amplify Data authorization issues)
      const result = await client.queries.getSocialProfileLambda();
      
      // Parse the response (Lambda returns JSON string)
      let response;
      if (typeof result.data === 'string') {
        const parsedData = JSON.parse(result.data);
        if (parsedData.body) {
          response = JSON.parse(parsedData.body);
        } else {
          response = parsedData;
        }
      } else {
        response = result.data;
      }

      if (response?.success && response?.profile) {
        // Convert Lambda response to SocialProfile type
        const profileData = {
          id: response.profile.id,
          cognitoId: response.profile.cognitoId,
          email: response.profile.email,
          username: response.profile.username,
          displayName: response.profile.displayName,
          avatar: response.profile.avatar,
          bio: response.profile.bio,
          role: response.profile.role,
          subscriptionStatus: response.profile.subscriptionStatus,
          subscriptionPlan: response.profile.subscriptionPlan,
          subscriptionExpiresAt: response.profile.subscriptionExpiresAt,
          trialEndsAt: response.profile.trialEndsAt,
          isOgPricing: response.profile.isOgPricing,
          ogPriceMtrMonthly: response.profile.ogPriceMtrMonthly,
          ogPriceMtrAnnual: response.profile.ogPriceMtrAnnual,
          moderationStatus: response.profile.moderationStatus,
          tenureBadge: response.profile.tenureBadge,
          modulrAddress: response.profile.modulrAddress,
          createdAt: response.profile.createdAt,
        } as SocialProfile;
        
        setProfile(profileData);
        
        // Only log in development
        if (import.meta.env.DEV) {
          logger.log('[useSocialProfile] Profile loaded:', profileData.username || 'no username');
        }
      } else {
        // No profile yet - that's okay, user just hasn't registered a username
        setProfile(null);
      }
    } catch (err) {
      // Only log errors in development
      if (import.meta.env.DEV) {
        logger.error('[useSocialProfile] Error loading profile:', err);
      }
      setError('Failed to load profile');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [user?.username]);

  // Load profile on mount and when user changes
  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Listen for profile update events (e.g., after username registration)
  useEffect(() => {
    const handleProfileUpdate = () => {
      loadProfile();
    };
    window.addEventListener('socialProfileUpdated', handleProfileUpdate);
    return () => window.removeEventListener('socialProfileUpdated', handleProfileUpdate);
  }, [loadProfile]);

  // Derived values
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
    loading,
    error,
    refetch: loadProfile,
  };
}

/**
 * Dispatch this event after updating the social profile (e.g., username registration)
 * to notify all useSocialProfile hooks to refetch
 */
export function notifySocialProfileUpdated(): void {
  window.dispatchEvent(new Event('socialProfileUpdated'));
}
