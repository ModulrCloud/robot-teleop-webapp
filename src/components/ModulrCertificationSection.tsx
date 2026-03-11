import { useState, useEffect, useCallback, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faExclamationCircle,
  faInfoCircle,
  faSpinner,
  faCreditCard,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useUserCredits } from "../hooks/useUserCredits";
import { fetchExchangeRates, formatCreditsAsCurrencySync, type CurrencyCode } from "../utils/credits";
import { logger } from "../utils/logger";

const client = generateClient<Schema>();

const DEFAULT_FEE_CREDITS = 1000;

export interface CertificationRequestItem {
  id?: string;
  robotId?: string;
  robotUuid?: string;
  partnerId?: string;
  partnerUserId?: string;
  status?: string;
  requestedAt?: string;
  paidAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  amountCredits?: number;
}

interface ListResponse {
  requests: CertificationRequestItem[];
  nextToken: string | null;
}

function formatCertifiedDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return iso;
  }
}

/** Open statuses: user can still be in "payment pending" or "pending review" flow. */
const OPEN_STATUSES = ["requested", "paid", "pending_review"];

/**
 * Parse Lambda response from Amplify. Handles wrapped { statusCode, body } (and Body),
 * double-encoded string, or direct { success, error }.
 */
function parseLambdaJsonResponse(
  raw: string | null | undefined
): { success?: boolean; error?: string; [key: string]: unknown } | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (parsed == null) return null;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const bodyRaw = obj.body ?? obj.Body;
  if (bodyRaw !== undefined) {
    const payload =
      typeof bodyRaw === "string"
        ? (() => {
            try {
              return JSON.parse(bodyRaw) as Record<string, unknown>;
            } catch {
              return null;
            }
          })()
        : bodyRaw && typeof bodyRaw === "object"
          ? (bodyRaw as Record<string, unknown>)
          : null;
    if (payload && typeof payload === "object") return payload as { success?: boolean; error?: string; [key: string]: unknown };
  }
  if (obj.success !== undefined || obj.error !== undefined) {
    return obj as { success?: boolean; error?: string; [key: string]: unknown };
  }
  return obj as { success?: boolean; error?: string; [key: string]: unknown };
}

/** Parse Lambda list response (handles wrapped { statusCode, body } or double-encoded string). */
function parseListResponse(raw: string | ListResponse | null | undefined): ListResponse {
  if (raw == null) return { requests: [], nextToken: null };
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { requests: [], nextToken: null };
  }
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return { requests: [], nextToken: null };
    }
  }
  if (parsed != null && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const bodyRaw = obj.body ?? obj.Body;
    if (bodyRaw !== undefined) {
      const payload: ListResponse | null =
        typeof bodyRaw === "string"
          ? (() => {
              try {
                return JSON.parse(bodyRaw) as unknown as ListResponse;
              } catch {
                return null;
              }
            })()
          : (bodyRaw as unknown as ListResponse);
      if (payload && Array.isArray(payload.requests)) return payload;
    }
    if (Array.isArray((obj as unknown as ListResponse).requests)) return obj as unknown as ListResponse;
  }
  return { requests: [], nextToken: null };
}

function pickCurrentRequest(
  requests: CertificationRequestItem[],
  robotId: string
): CertificationRequestItem | undefined {
  const forRobot = requests.filter((r) => r.robotId === robotId);
  const open = forRobot.find((r) => OPEN_STATUSES.includes(r.status ?? ""));
  if (open) return open;
  const rejected = forRobot.filter((r) => r.status === "rejected");
  if (rejected.length > 0) {
    rejected.sort(
      (a, b) =>
        new Date(b.requestedAt ?? 0).getTime() -
        new Date(a.requestedAt ?? 0).getTime()
    );
    return rejected[0];
  }
  return undefined;
}

export interface ModulrCertificationSectionProps {
  robotId: string;
  robotUuid?: string;
  modulrApproved: boolean;
  modulrApprovedAt?: string | null;
  isViewMode?: boolean;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export const ModulrCertificationSection = ({
  robotId,
  modulrApproved,
  modulrApprovedAt,
  isViewMode = false,
  onError,
  onSuccess,
}: ModulrCertificationSectionProps) => {
  const { credits: userCredits, loading: loadingCredits, currency: userCurrency } = useUserCredits();
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | undefined>();
  const [certificationFee, setCertificationFee] = useState<number>(DEFAULT_FEE_CREDITS);
  const [requests, setRequests] = useState<CertificationRequestItem[]>([]);
  const [loadingFee, setLoadingFee] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<"create" | "pay" | null>(null);
  const fetchIdRef = useRef(0);
  const hasEnoughCredits = userCredits >= certificationFee;
  const feeFormatted = formatCreditsAsCurrencySync(certificationFee, (userCurrency ?? "USD") as CurrencyCode, exchangeRates);

  const loadFee = useCallback(async () => {
    setLoadingFee(true);
    try {
      const { data: settings } = await client.models.PlatformSettings.list({
        filter: { settingKey: { eq: "modulrCertificationFeeCredits" } },
      });
      if (settings?.length) {
        const val = parseInt(settings[0].settingValue ?? "1000", 10);
        setCertificationFee(Number.isNaN(val) ? DEFAULT_FEE_CREDITS : val);
      } else {
        setCertificationFee(DEFAULT_FEE_CREDITS);
      }
    } catch (err) {
      logger.error("Error loading certification fee", err);
      setCertificationFee(DEFAULT_FEE_CREDITS);
    } finally {
      setLoadingFee(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    if (!robotId) {
      setLoadingRequests(false);
      return;
    }
    const thisFetchId = fetchIdRef.current + 1;
    fetchIdRef.current = thisFetchId;
    setLoadingRequests(true);
    setSectionError(null);
    try {
      const result = await client.queries.listCertificationRequestsLambda({
        limit: 100,
      });
      const raw = typeof result.data === "string" ? result.data : result.data != null ? JSON.stringify(result.data) : undefined;
      const data = parseListResponse(raw);
      if (fetchIdRef.current !== thisFetchId) return;
      setRequests(data.requests ?? []);
    } catch (err) {
      logger.error("Error loading certification requests", err);
      if (fetchIdRef.current === thisFetchId) {
        setSectionError(err instanceof Error ? err.message : "Failed to load certification status");
        setRequests([]);
      }
    } finally {
      if (fetchIdRef.current === thisFetchId) setLoadingRequests(false);
    }
  }, [robotId]);

  useEffect(() => {
    loadFee();
  }, [loadFee]);

  useEffect(() => {
    fetchExchangeRates().then(setExchangeRates).catch(() => {});
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const currentRequest = pickCurrentRequest(requests, robotId);
  const isRequested = currentRequest?.status === "requested";
  const isPaidOrPending =
    currentRequest?.status === "paid" || currentRequest?.status === "pending_review";
  const isRejected = currentRequest?.status === "rejected";
  const showNoRequestState =
    !modulrApproved && !currentRequest;
  const showRequestAgain =
    !modulrApproved && isRejected;

  const handleRequestCertification = async () => {
    if (!robotId || isViewMode) return;
    setActionLoading("create");
    setSectionError(null);
    try {
      const result = await client.mutations.createCertificationRequestLambda({
        robotId,
      });
      const resultWithErrors = result as { data?: unknown; errors?: Array<{ message?: string }> };

      if (resultWithErrors.errors && resultWithErrors.errors.length > 0) {
        const upstreamMsg = resultWithErrors.errors.map((e) => e.message ?? JSON.stringify(e)).join(", ");
        setSectionError(upstreamMsg);
        onError?.(upstreamMsg);
        return;
      }

      const data = parseLambdaJsonResponse(
        typeof resultWithErrors.data === "string"
          ? resultWithErrors.data
          : resultWithErrors.data != null
            ? JSON.stringify(resultWithErrors.data)
            : undefined
      );
      const rawError =
        typeof data?.error === "string"
          ? data.error
          : typeof (data as Record<string, unknown>)?.errorMessage === "string"
            ? (data as Record<string, unknown>).errorMessage
            : typeof (data as Record<string, unknown>)?.message === "string"
              ? (data as Record<string, unknown>).message
              : "";

      if (data?.success) {
        onSuccess?.("Certification requested. Complete payment below.");
        await loadRequests();
      } else {
        const msg: string =
          rawError === "Robot is already Modulr Approved"
            ? "This robot is already Modulr Approved."
            : rawError === "A certification request is already open for this robot"
              ? "A certification request is already open. Complete payment below."
              : typeof rawError === "string" ? rawError : "Request failed. Please try again.";
        setSectionError(msg);
        onError?.(msg);
      }
    } catch (err) {
      logger.error("Error creating certification request", err);
      const msg: string =
        err instanceof Error ? String(err.message) : "Request failed. Please try again.";
      setSectionError(msg);
      onError?.(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePay = async () => {
    const id = currentRequest?.id;
    if (!id || !robotId || isViewMode) return;
    setActionLoading("pay");
    setSectionError(null);
    try {
      const result = await client.mutations.processCertificationPaymentLambda({
        certificationRequestId: id,
      });
      const resultWithErrors = result as { data?: unknown; errors?: Array<{ message?: string }> };

      if (resultWithErrors.errors && resultWithErrors.errors.length > 0) {
        const upstreamMsg = resultWithErrors.errors.map((e) => e.message ?? JSON.stringify(e)).join(", ");
        setSectionError(upstreamMsg);
        onError?.(upstreamMsg);
        return;
      }

      const data = parseLambdaJsonResponse(
        typeof resultWithErrors.data === "string"
          ? resultWithErrors.data
          : resultWithErrors.data != null
            ? JSON.stringify(resultWithErrors.data)
            : undefined
      );

      if (data?.success) {
        onSuccess?.("Payment complete. Your request is pending Modulr review.");
        window.dispatchEvent(new CustomEvent("creditsUpdated"));
        await loadRequests();
      } else {
        const raw = typeof data?.error === "string" ? data.error : "";
        const msg =
          raw === "Insufficient credits"
            ? `Insufficient credits. You need ${currentRequest?.amountCredits ?? 0} credits. Top up your balance and try again.`
            : raw || "Payment failed. Please try again.";
        setSectionError(msg);
        onError?.(msg);
      }
    } catch (err) {
      logger.error("Error processing certification payment", err);
      const msg: string =
        err instanceof Error ? String(err.message) : "Payment failed. Please try again.";
      setSectionError(msg);
      onError?.(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const isLoading = loadingFee || loadingRequests;
  if (isLoading && requests.length === 0 && !modulrApproved) {
    return (
      <div className="form-section modulr-certification-section">
        <h3>Modulr certification</h3>
        <div className="modulr-cert-loading">
          <FontAwesomeIcon icon={faSpinner} spin />
          <span>Loading certification status…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="form-section modulr-certification-section">
      <h3>Modulr certification</h3>

      {sectionError && (
        <div className="modulr-cert-error">
          <FontAwesomeIcon icon={faExclamationCircle} />
          <span>{sectionError}</span>
        </div>
      )}

      {modulrApproved && (
        <div className="modulr-cert-state modulr-cert-approved">
          <FontAwesomeIcon icon={faCheckCircle} />
          <div>
            <strong>Modulr Approved</strong>
            {modulrApprovedAt && (
              <p className="modulr-cert-date">
                Certified on {formatCertifiedDate(modulrApprovedAt)}
              </p>
            )}
          </div>
        </div>
      )}

      {!modulrApproved && showNoRequestState && (
        <div className="modulr-cert-state modulr-cert-state-stack">
          <p>
            Request Modulr certification for this robot. Fee:{" "}
            <strong>{loadingFee ? "…" : feeFormatted}</strong>.
          </p>
          {!isViewMode && !hasEnoughCredits && !loadingCredits && (
            <p className="modulr-cert-insufficient">
              Insufficient credits. Top up to request certification.
            </p>
          )}
          {!isViewMode && (
            <button
              type="button"
              className="submit-btn modulr-cert-btn"
              onClick={handleRequestCertification}
              disabled={actionLoading !== null || !hasEnoughCredits || loadingCredits}
            >
              {actionLoading === "create" ? (
                <>
                  <FontAwesomeIcon icon={faSpinner} spin />
                  <span>Requesting…</span>
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faInfoCircle} />
                  <span>Request certification</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {!modulrApproved && isRequested && (
        <div className="modulr-cert-state modulr-cert-payment-pending">
          <FontAwesomeIcon icon={faCreditCard} />
          <div>
            <p><strong>Payment pending</strong></p>
            <p>
              Complete payment of{" "}
              <strong>
                {formatCreditsAsCurrencySync(currentRequest?.amountCredits ?? 0, (userCurrency ?? "USD") as CurrencyCode, exchangeRates)}
              </strong>{" "}
              to submit for Modulr review.
            </p>
            {!isViewMode && (
              <button
                type="button"
                className="submit-btn modulr-cert-btn"
                onClick={handlePay}
                disabled={actionLoading !== null}
              >
                {actionLoading === "pay" ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    <span>Processing…</span>
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faCreditCard} />
                    <span>Pay {formatCreditsAsCurrencySync(currentRequest?.amountCredits ?? 0, (userCurrency ?? "USD") as CurrencyCode, exchangeRates)}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {!modulrApproved && isPaidOrPending && (
        <div className="modulr-cert-state modulr-cert-pending-review">
          <FontAwesomeIcon icon={faInfoCircle} />
          <p><strong>Certification requested – pending Modulr review.</strong></p>
          <p>You will be notified once the review is complete.</p>
        </div>
      )}

      {!modulrApproved && showRequestAgain && (
        <div className="modulr-cert-state modulr-cert-rejected">
          <FontAwesomeIcon icon={faExclamationCircle} />
          <div>
            <p><strong>Certification was not approved.</strong></p>
            {currentRequest?.rejectionReason && (
              <p className="modulr-cert-reason">{currentRequest.rejectionReason}</p>
            )}
            {!isViewMode && !hasEnoughCredits && !loadingCredits && (
              <p className="modulr-cert-insufficient">
                Insufficient credits. Top up to request again.
              </p>
            )}
            {!isViewMode && (
              <button
                type="button"
                className="submit-btn modulr-cert-btn"
                onClick={handleRequestCertification}
                disabled={actionLoading !== null || !hasEnoughCredits || loadingCredits}
              >
                {actionLoading === "create" ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    <span>Requesting…</span>
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <span>Request again</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
