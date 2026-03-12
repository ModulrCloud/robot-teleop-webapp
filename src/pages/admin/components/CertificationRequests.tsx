import { useState, useEffect, useCallback, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClipboardCheck,
  faCheck,
  faCheckCircle,
  faTimes,
  faExclamationCircle,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { useToast } from "../../../hooks/useToast";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import "../../Admin.css";

const client = generateClient<Schema>();

export interface CertificationRequestItem {
  id?: string;
  robotId?: string;
  robotUuid?: string;
  partnerId?: string;
  partnerUserId?: string;
  partnerEmail?: string;
  status?: string;
  requestedAt?: string;
  paidAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  amountCredits?: number;
  robotName?: string;
}

interface ListResponse {
  requests: CertificationRequestItem[];
  nextToken: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  paid: "Paid",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending_review", label: "Pending review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatStatus(status?: string): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
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

/** Parse manageCertificationRequest Lambda response (wrapped body or double-encoded). */
function parseManageResponse(raw: string | Record<string, unknown> | null | undefined): { success?: boolean; error?: string } | null {
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (parsed == null || typeof parsed !== "object") return null;
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
    if (payload && ("success" in payload || "error" in payload)) return payload as { success?: boolean; error?: string };
  }
  if (obj.success !== undefined || obj.error !== undefined) return obj as { success?: boolean; error?: string };
  return obj as { success?: boolean; error?: string };
}

export const CertificationRequests = () => {
  const { user } = useAuthStatus();
  const [requests, setRequests] = useState<CertificationRequestItem[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("pending_review");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: string; robotName?: string } | null>(null);
  const { toast, showToast } = useToast();
  const [rejectReason, setRejectReason] = useState("");
  const fetchIdRef = useRef(0);

  const loadRequests = useCallback(
    async (token?: string | null) => {
      if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
        return;
      }

      const thisFetchId = fetchIdRef.current + 1;
      fetchIdRef.current = thisFetchId;

      setLoading(true);
      try {
        const statusParam =
          statusFilter === "all"
            ? undefined
            : statusFilter === "pending_review"
              ? undefined
              : statusFilter;

        const result = await client.queries.listCertificationRequestsLambda({
          limit: 50,
          status: statusParam,
          nextToken: token || undefined,
        });

        const raw = typeof result.data === "string" ? result.data : result.data != null ? JSON.stringify(result.data) : undefined;
        const data = parseListResponse(raw);

        let items = data.requests ?? [];
        if (statusFilter === "pending_review") {
          items = items.filter(
            (r) => r.status === "paid" || r.status === "pending_review"
          );
        }

        if (fetchIdRef.current !== thisFetchId) return;

        if (token) {
          setRequests((prev) => [...prev, ...items]);
        } else {
          setRequests(items);
        }
        setNextToken(data.nextToken ?? null);
      } catch (err) {
        logger.error("Error loading certification requests", err);
        if (fetchIdRef.current !== thisFetchId) return;
        if (!token) {
          setRequests([]);
          showToast(err instanceof Error ? err.message : "Failed to load certification requests", "error");
        }
      } finally {
        if (fetchIdRef.current === thisFetchId) setLoading(false);
      }
    },
    [user?.email, user?.group, statusFilter, showToast]
  );

  useEffect(() => {
    loadRequests(null);
  }, [loadRequests]);

  const handleLoadMore = () => {
    if (nextToken) loadRequests(nextToken);
  };

  const handleApprove = async (id: string) => {
    if (!id) return;
    setActionLoadingId(id);
    try {
      const result = await client.mutations.manageCertificationRequestLambda({
        certificationRequestId: id,
        action: "approve",
      });
      const resultWithErrors = result as { data?: unknown; errors?: Array<{ message?: string }> };
      if (resultWithErrors.errors?.length) {
        const msg = resultWithErrors.errors.map((e) => e.message ?? JSON.stringify(e)).join(", ");
        showToast(msg, "error");
        return;
      }
      const raw = typeof resultWithErrors.data === "string" ? resultWithErrors.data : resultWithErrors.data != null ? JSON.stringify(resultWithErrors.data) : undefined;
      const data = parseManageResponse(raw);
      if (data?.success) {
        showToast("Request approved. Robot is now Modulr Approved.", "success");
        loadRequests(null);
      } else {
        showToast(typeof data?.error === "string" ? data.error : "Approve failed", "error");
      }
    } catch (err) {
      logger.error("Error approving request", err);
      showToast(err instanceof Error ? err.message : "Approve failed", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (id: string, reason: string) => {
    if (!id) return;
    setActionLoadingId(id);
    setRejectModal(null);
    setRejectReason("");
    try {
      const result = await client.mutations.manageCertificationRequestLambda({
        certificationRequestId: id,
        action: "reject",
        rejectionReason: reason || undefined,
      });
      const resultWithErrors = result as { data?: unknown; errors?: Array<{ message?: string }> };
      if (resultWithErrors.errors?.length) {
        const msg = resultWithErrors.errors.map((e) => e.message ?? JSON.stringify(e)).join(", ");
        showToast(msg, "error");
        return;
      }
      const raw = typeof resultWithErrors.data === "string" ? resultWithErrors.data : resultWithErrors.data != null ? JSON.stringify(resultWithErrors.data) : undefined;
      const data = parseManageResponse(raw);
      if (data?.success) {
        showToast("Request rejected.", "error");
        loadRequests(null);
      } else {
        showToast(typeof data?.error === "string" ? data.error : "Reject failed", "error");
      }
    } catch (err) {
      logger.error("Error rejecting request", err);
      showToast(err instanceof Error ? err.message : "Reject failed", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const canLoadMore = !!nextToken && !loading;
  const canAct = (r: CertificationRequestItem) =>
    r.status === "paid" || r.status === "pending_review";

  if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
    return null;
  }

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faClipboardCheck} className="section-icon" />
        <h2>Certification requests</h2>
      </div>
      <p className="section-description">
        Review and approve or reject certification requests. Only requests in Paid or Pending review can be acted on.
      </p>

      <div className="section-content">
        <div className="admin-revenue-filters" style={{ marginBottom: "1rem" }}>
          <label className="admin-filter-group">
            <span className="admin-filter-label">Status</span>
            <select
              className="admin-select"
              value={statusFilter}
              onClick={() => loadRequests(null)}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading && requests.length === 0 ? (
          <div className="loading-state">
            <p>Loading certification requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <>
            <p className="section-description">
              No certification requests match the current filter.
            </p>
            {nextToken && (
              <p className="section-description" style={{ marginTop: "0.5rem" }}>
                More pages may be available.
              </p>
            )}
            {canLoadMore && (
              <div style={{ marginTop: "1rem", textAlign: "center" }}>
                <button
                  type="button"
                  className="admin-button admin-button-secondary"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  <FontAwesomeIcon icon={faChevronDown} />
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Robot</th>
                    <th>Partner email</th>
                    <th>Requested</th>
                    <th>Paid</th>
                    <th>Amount (credits)</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id ?? String(Math.random())}>
                      <td>{req.robotName ?? req.robotId ?? "—"}</td>
                      <td>{req.partnerEmail ?? "—"}</td>
                      <td>{formatDateTime(req.requestedAt)}</td>
                      <td>{formatDateTime(req.paidAt)}</td>
                      <td>{(req.amountCredits ?? 0).toLocaleString()}</td>
                      <td>{formatStatus(req.status)}</td>
                      <td>
                        {canAct(req) && (
                          <span className="admin-actions-inline">
                            <button
                              type="button"
                              className="admin-button"
                              onClick={() => handleApprove(req.id!)}
                              disabled={actionLoadingId !== null}
                              aria-label="Approve"
                            >
                              {actionLoadingId === req.id ? "…" : <FontAwesomeIcon icon={faCheck} />}
                            </button>
                            <button
                              type="button"
                              className="admin-button admin-button-danger"
                              onClick={() =>
                                setRejectModal({ id: req.id!, robotName: req.robotName })
                              }
                              disabled={actionLoadingId !== null}
                              aria-label="Reject"
                            >
                              <FontAwesomeIcon icon={faTimes} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canLoadMore && (
              <div style={{ marginTop: "1rem", textAlign: "center" }}>
                <button
                  type="button"
                  className="admin-button admin-button-secondary"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  <FontAwesomeIcon icon={faChevronDown} />
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {rejectModal && (
        <div
          className="admin-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-modal-title"
          onClick={(e) => e.target === e.currentTarget && setRejectModal(null)}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="reject-modal-title">Reject certification request</h3>
            {rejectModal.robotName && (
              <p className="section-description">Robot: {rejectModal.robotName}</p>
            )}
            <label className="admin-filter-group" style={{ marginTop: "0.75rem" }}>
              <span className="admin-filter-label">Rejection reason (optional)</span>
              <textarea
                className="admin-input admin-reject-textarea"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Optional reason for the partner"
              />
            </label>
            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-button admin-button-secondary"
                onClick={() => {
                  setRejectModal(null);
                  setRejectReason("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-button admin-button-danger"
                onClick={() => handleReject(rejectModal.id, rejectReason)}
                disabled={actionLoadingId !== null}
              >
                {actionLoadingId === rejectModal.id ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast.visible && (
        <div className={`toast-notification ${toast.type}`}>
          <FontAwesomeIcon icon={toast.type === "error" ? faExclamationCircle : faCheckCircle} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};
