import { useEffect, useState } from "react";
import { getCurrentUser, fetchUserAttributes, signOut as amplifySignOut, fetchAuthSession } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";

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
  
  console.log("Signing out of backend...");
  await amplifySignOut({ global: true });
  console.log("Clearing tokens from local storage...");
  Object.keys(localStorage).forEach((key) => {
    if (amplifyPrefixes.some((prefix) => key.startsWith(prefix))) {
      console.log(`Clear ${key} from local storage`);
      localStorage.removeItem(key);
    }
  });
}

function highestPriorityGroup(groups: any | undefined): AuthGroup | null {
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
        const currentUser = await getCurrentUser();
        const attrs = await fetchUserAttributes();
        const session = await fetchAuthSession();
        const groups = session.tokens?.accessToken?.payload['cognito:groups'];
        const group = highestPriorityGroup(groups);

        if (mounted) {
          setIsLoggedIn(true);
          setUser({
            username: currentUser.username,
            name: attrs.name ?? null,
            email: attrs.email ?? null,
            displayName: attrs.name ?? attrs.email,
            group,
          });
        }
      } catch {
        if (mounted) {
          setIsLoggedIn(false);
          setUser(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadUser();

    // Subscribe to sign-in/sign-out events
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      const { event } = payload;
      if (event === "signedIn") loadUser();
      else if (event === "signedOut" || event === "tokenRefresh_failure") {
        setIsLoggedIn(false);
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { isLoggedIn, user, loading, signOut };
}
