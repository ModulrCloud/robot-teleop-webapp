import { useState, useEffect, useCallback } from "react";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { useTermsContent } from "../hooks/useTermsContent";
import { TermsAcceptanceModal } from "./TermsAcceptanceModal";
import { logger } from "../utils/logger";
import { TERMS_VERSION_DEFAULT, TERMS_LAST_UPDATED_DEFAULT } from "../content/terms-v1";

const client = generateClient<Schema>();

interface TermsStatus {
  success: boolean;
  currentVersion: string;
  currentLastUpdatedAt: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  mustAccept: boolean;
}

function parseTermsStatusData(data: unknown): TermsStatus | null {
  let obj: unknown = data;
  if (typeof data === "string") {
    try {
      obj = JSON.parse(data);
      while (typeof obj === "string") {
        obj = JSON.parse(obj);
      }
    } catch {
      return null;
    }
  }
  if (typeof obj === "object" && obj !== null && "success" in (obj as TermsStatus)) {
    return obj as TermsStatus;
  }
  return null;
}

interface TermsGateProps {
  children: React.ReactNode;
}

export function TermsGate({ children }: TermsGateProps) {
  const { isLoggedIn, loading: authLoading, signOut } = useAuthStatus();
  const { contentHtml } = useTermsContent();
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const fetchStatus = useCallback(
    async (options?: { skipIfAlreadyAccepted?: boolean }) => {
      if (!isLoggedIn) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await client.queries.getTermsStatusLambda();
        const data = parseTermsStatusData(result.data);
        if (data?.success) {
          setStatus((prev) => {
            if (options?.skipIfAlreadyAccepted && prev?.mustAccept === false && data.mustAccept === true) {
              return prev;
            }
            return data;
          });
        } else {
          setStatus((prev) => (options?.skipIfAlreadyAccepted && prev?.mustAccept === false ? prev : null));
        }
      } catch (err) {
        logger.warn("Terms status fetch failed:", err);
        setStatus((prev) => (options?.skipIfAlreadyAccepted && prev?.mustAccept === false ? prev : null));
      } finally {
        setLoading(false);
      }
    },
    [isLoggedIn]
  );

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const currentVersion = status?.currentVersion ?? TERMS_VERSION_DEFAULT;
  const currentLastUpdatedAt = status?.currentLastUpdatedAt ?? TERMS_LAST_UPDATED_DEFAULT;

  const handleAccept = async () => {
    setAcceptError(null);
    setAccepting(true);
    try {
      const result = await client.mutations.acceptTermsLambda({
        termsVersion: currentVersion,
      });
      let raw: { success?: boolean; acceptedTermsAt?: string } | null = null;
      const data = result.data;
      if (typeof data === "string") {
        try {
          raw = JSON.parse(data);
          if (typeof raw === "string") raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      } else if (data && typeof data === "object") {
        raw = data as { success?: boolean; acceptedTermsAt?: string };
      }
      if (raw?.success) {
        setStatus(() => ({
          success: true,
          currentVersion,
          currentLastUpdatedAt,
          acceptedVersion: currentVersion,
          acceptedAt: raw.acceptedTermsAt ?? new Date().toISOString(),
          mustAccept: false,
        }));
        fetchStatus({ skipIfAlreadyAccepted: true }); // refetch in background; don't overwrite accepted state with stale read
      } else {
        setAcceptError("Could not save. Please try again.");
      }
    } catch (err) {
      logger.error("Accept terms failed:", err);
      setAcceptError("Unable to save acceptance. Please check your connection and try again.");
    } finally {
      setAccepting(false);
    }
  };

  // Show modal when: logged in, done loading, and either mustAccept is true OR we couldn't get status (e.g. Lambda not deployed yet)
  const showModal =
    isLoggedIn &&
    !authLoading &&
    !loading &&
    (status?.mustAccept === true || status === null);

  return (
    <>
      {children}
      {showModal && (
        <TermsAcceptanceModal
          isOpen
          currentVersion={currentVersion}
          currentLastUpdatedAt={currentLastUpdatedAt}
          contentHtml={contentHtml}
          onAccept={handleAccept}
          onDecline={() => signOut()}
          accepting={accepting}
          errorMessage={acceptError}
        />
      )}
    </>
  );
}
