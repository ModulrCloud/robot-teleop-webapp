import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faImage,
  faCheck,
  faCheckCircle,
  faTimes,
  faExclamationCircle,
  faSync,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { useToast } from "../../../hooks/useToast";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import "../../Admin.css";

const client = generateClient<Schema>();

interface PendingRobot {
  id: string;
  name: string;
  robotId: string;
  robotType?: string;
  partnerId: string;
  partnerName?: string;
  imageVerificationRequestedAt?: string;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export const ImageVerificationRequests = () => {
  const { user } = useAuthStatus();
  const { toast, showToast } = useToast();
  const [pendingRobots, setPendingRobots] = useState<PendingRobot[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: string; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadPendingRequests = useCallback(async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) return;

    setLoading(true);
    try {
      const robotsResponse = await client.models.Robot.list({
        filter: {
          imageVerificationRequested: { eq: true },
          isVerified: { ne: true },
        },
        limit: 200,
      });

      if (robotsResponse.errors) {
        throw new Error(robotsResponse.errors[0]?.message || "Failed to load");
      }

      const robots = robotsResponse.data || [];

      const partnerIds = [...new Set(robots.map((r) => r.partnerId).filter(Boolean))];
      const partnerMap: Record<string, string> = {};
      await Promise.all(
        partnerIds.map(async (pid) => {
          try {
            const p = await client.models.Partner.get({ id: pid });
            if (p.data) {
              const label =
                p.data.displayName?.trim() ||
                p.data.name?.trim() ||
                p.data.cognitoUsername ||
                pid;
              partnerMap[pid] = label;
            }
          } catch {
            // ignore
          }
        })
      );

      const items: PendingRobot[] = robots
        .filter((r) => r.id != null)
        .map((r) => ({
          id: r.id!,
          name: r.name || "Unnamed",
          robotId: r.robotId || "",
          robotType: r.robotType || undefined,
          partnerId: r.partnerId,
          partnerName: partnerMap[r.partnerId] || r.partnerId,
          imageVerificationRequestedAt:
            (r as unknown as { imageVerificationRequestedAt?: string }).imageVerificationRequestedAt || undefined,
        }));

      items.sort(
        (a, b) =>
          new Date(a.imageVerificationRequestedAt ?? 0).getTime() -
          new Date(b.imageVerificationRequestedAt ?? 0).getTime()
      );

      setPendingRobots(items);
    } catch (err) {
      logger.error("Error loading image verification requests", err);
      showToast(err instanceof Error ? err.message : "Failed to load requests", "error");
    } finally {
      setLoading(false);
    }
  }, [user?.email, user?.group, showToast]);

  useEffect(() => {
    loadPendingRequests();
  }, [loadPendingRequests]);

  const handleApprove = async (robotUuid: string) => {
    setActionLoadingId(robotUuid);
    try {
      const result = await client.mutations.updateRobotLambda({
        robotId: robotUuid,
        isVerified: true,
      });
      if (result.errors) {
        showToast(result.errors[0]?.message || "Approve failed", "error");
        return;
      }
      showToast("Robot verified — partner can now upload custom images.", "success");
      setPendingRobots((prev) => prev.filter((r) => r.id !== robotUuid));
    } catch (err) {
      logger.error("Error approving image verification", err);
      showToast(err instanceof Error ? err.message : "Approve failed", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (robotUuid: string, reason: string) => {
    setActionLoadingId(robotUuid);
    setRejectModal(null);
    setRejectReason("");
    try {
      const result = await client.mutations.updateRobotLambda({
        robotId: robotUuid,
        requestImageVerification: false,
        imageVerificationRejectedReason: reason || undefined,
      });
      if (result.errors) {
        showToast(result.errors[0]?.message || "Reject failed", "error");
        return;
      }
      showToast("Image verification request rejected.", "error");
      setPendingRobots((prev) => prev.filter((r) => r.id !== robotUuid));
    } catch (err) {
      logger.error("Error rejecting image verification", err);
      showToast(err instanceof Error ? err.message : "Reject failed", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
    return null;
  }

  return (
    <div className="admin-section" style={{ marginTop: "2rem" }}>
      <div className="section-header">
        <FontAwesomeIcon icon={faImage} className="section-icon" />
        <h2>Image verification requests</h2>
      </div>
      <p className="section-description">
        Partners who requested permission to upload custom robot images. Approve to unlock image uploads for the robot.
      </p>

      <div className="section-content">
        <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="admin-button admin-button-secondary"
            onClick={loadPendingRequests}
            disabled={loading}
          >
            <FontAwesomeIcon icon={faSync} spin={loading} />
            {loading ? " Loading…" : " Refresh"}
          </button>
        </div>

        {loading && pendingRobots.length === 0 ? (
          <div className="loading-state">
            <p>Loading image verification requests...</p>
          </div>
        ) : pendingRobots.length === 0 ? (
          <p className="section-description">No pending image verification requests.</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Robot</th>
                  <th>Robot ID</th>
                  <th>Partner</th>
                  <th>Type</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingRobots.map((robot) => (
                  <tr key={robot.id}>
                    <td>{robot.name}</td>
                    <td>{robot.robotId || "—"}</td>
                    <td>{robot.partnerName || "—"}</td>
                    <td>{robot.robotType || "—"}</td>
                    <td>{formatDateTime(robot.imageVerificationRequestedAt)}</td>
                    <td>
                      <span className="admin-actions-inline">
                        <button
                          type="button"
                          className="admin-button"
                          onClick={() => handleApprove(robot.id)}
                          disabled={actionLoadingId !== null}
                          title="Approve — allow custom image uploads"
                          aria-label="Approve"
                        >
                          {actionLoadingId === robot.id ? "…" : <FontAwesomeIcon icon={faCheck} />}
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button-danger"
                          onClick={() => setRejectModal({ id: robot.id, name: robot.name })}
                          disabled={actionLoadingId !== null}
                          title="Reject"
                          aria-label="Reject"
                        >
                          <FontAwesomeIcon icon={faTimes} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejectModal && (
        <div
          className="admin-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="img-reject-modal-title"
          onClick={(e) => e.target === e.currentTarget && setRejectModal(null)}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="img-reject-modal-title">Reject image verification</h3>
            <p className="section-description">Robot: {rejectModal.name}</p>
            <label className="admin-filter-group" style={{ marginTop: "0.75rem" }}>
              <span className="admin-filter-label">Rejection reason (optional)</span>
              <textarea
                className="admin-input admin-reject-textarea"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Optional reason shown to the partner"
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
