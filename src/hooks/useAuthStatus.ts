import { useEffect, useState } from "react";
import { getCurrentUser, fetchUserAttributes, signOut as amplifySignOut, fetchAuthSession } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";

type AuthGroup = "ADMINS" | "PARTNERS" | "CLIENTS";
const VALID_GROUPS: string[] = ["ADMINS", "PARTNERS", "CLIENTS"];

interface AuthStatus {
  isLoggedIn: boolean;
  user: {
    username?: string;
    name?: string | null;
    email?: string | null;
    displayName?: string | null;
    group?: AuthGroup | null;
  } | null;
  loading: boolean;
  signOut(): Promise<void>; 
}

async function signOut() {
  const amplifyPrefixes = [
    "CognitoIdentityServiceProvider",
    "amplify-signin-with-hostedUI",
  ];
  
  try {
    // Get current token before signing out so we can revoke it
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();
    
    // Revoke the token before signing out
    if (idToken) {
      try {
        const client = generateClient<Schema>();
        await client.mutations.revokeTokenLambda({ token: idToken });
        // console.log("Token revoked successfully");
      } catch (revokeError) {
        // Log but don't block sign-out if revocation fails
        console.warn("Failed to revoke token (continuing with sign-out):", revokeError);
      }
    }
  } catch (error) {
    // If we can't get the token, continue with sign-out anyway
    console.warn("Could not get token for revocation (continuing with sign-out):", error);
  }
  
  // Debug logging (commented out - uncomment for debugging)
  // console.log("Signing out of backend...");
  await amplifySignOut({ global: true });
  // console.log("Clearing tokens from local storage...");
  Object.keys(localStorage).forEach((key) => {
    if (amplifyPrefixes.some((prefix) => key.startsWith(prefix))) {
      // console.log(`Clear ${key} from local storage`);
      localStorage.removeItem(key);
    }
  });
}

function highestPriorityGroup(groups: string[] | undefined): AuthGroup | null {
  if (!groups) {
    return null;
  }

  for (const key of VALID_GROUPS) {
    if (groups.includes(key)) {
      return key as AuthGroup;
    }
  }
  return null;
}

/**
 * Hook that tracks Amplify auth status in real time.
 */
export function useAuthStatus(): AuthStatus {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<AuthStatus["user"]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadUser = async () => {
      try {
        // Verify Amplify is configured before making calls
        const { Amplify } = await import('aws-amplify');
        const config = Amplify.getConfig();
        if (!config || !config.Auth) {
          console.warn('Amplify not configured yet, skipping auth check');
          if (mounted) {
            setIsLoggedIn(false);
            setUser(null);
            setLoading(false);
          }
          return;
        }

        // Debug logging (commented out - uncomment for debugging)
        // console.log('🔍 Attempting to get current user...');
        const currentUser = await getCurrentUser();
        // console.log('✅ Current user:', { username: currentUser.username });
        
        const attrs = await fetchUserAttributes();
        // console.log('✅ User attributes:', { name: attrs.name, email: attrs.email });
        
        const session = await fetchAuthSession();
        // console.log('✅ Auth session:', {
        //   isValid: !!session.tokens,
        //   hasAccessToken: !!session.tokens?.accessToken,
        //   hasIdToken: !!session.tokens?.idToken
        // });
        
        const groups = session.tokens?.accessToken?.payload['cognito:groups'];
        const group = highestPriorityGroup(groups as string[] | undefined);
        // console.log('✅ User groups:', { groups, highestPriority: group });

        if (mounted) {
          setIsLoggedIn(true);
          setUser({
            username: currentUser.username,
            name: attrs.name ?? null,
            email: attrs.email ?? null,
            displayName: attrs.name ?? attrs.email,
            group,
          });
          // console.log('✅ Auth status updated - user is logged in');
        }
      } catch (error) {
        // Log the actual error for debugging (commented out - uncomment for debugging)
        // Only log if it's not the expected "user not authenticated" error
        if (error instanceof Error && error.name !== 'UserUnAuthenticatedException') {
          console.warn('⚠️ Auth check failed:', error);
          console.warn('⚠️ Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
          });
        }
        // else {
        //   console.warn('⚠️ Non-Error object:', error);
        // }
        if (mounted) {
          setIsLoggedIn(false);
          setUser(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Small delay to ensure Amplify config has propagated
    const timer = setTimeout(() => {
      loadUser();
    }, 100);

    // Subscribe to sign-in/sign-out events
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      const { event, data } = payload;
      // Debug logging (commented out - uncomment for debugging)
      // console.log('🔔 Auth Hub event received:', { event, data, payload });
      
      if (event === "signedIn" || event === "tokenRefresh") {
        // console.log('✅ Signed in event detected, loading user...');
        loadUser();
      } else if (event === "signedOut" || event === "tokenRefresh_failure") {
        // console.log('❌ Signed out or token refresh failure:', event);
        setIsLoggedIn(false);
        setUser(null);
      }
      // else {
      //   console.log('ℹ️ Other auth event:', event);
      // }
    });

    return () => {
      mounted = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return { isLoggedIn, user, loading, signOut };
}
