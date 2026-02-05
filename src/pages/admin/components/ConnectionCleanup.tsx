import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBroom,
  faSync,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import "../../Admin.css";

const client = generateClient<Schema>();

export const ConnectionCleanup = () => {
  const { user } = useAuthStatus();
  const [activeRobots, setActiveRobots] = useState<{
    activeRobots?: number;
    totalConnections?: number;
    clientConnections?: number;
    monitorConnections?: number;
    robotPresenceEntries?: Array<{ robotId: string; connectionId: string; status: string; updatedAt: number | null }>;
    connTableEntries?: Array<{ connectionId: string; kind: string; ts: number | null }>;
  } | null>(null);
  const [triggeringCleanup, setTriggeringCleanup] = useState(false);
  const [lastCleanupMessage, setLastCleanupMessage] = useState<string | null>(null);

  const loadActiveRobots = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      return;
    }

    // Loading state handled internally
    try {
      logger.log("🔍 Loading active robots...");
      const result = await client.queries.getActiveRobotsLambda();

      logger.log("[CONN_CLEANUP_DEBUG] Raw result:", {
        dataType: typeof result.data,
        dataIsString: typeof result.data === "string",
        dataLength: typeof result.data === "string" ? result.data.length : "n/a",
        dataPreview: typeof result.data === "string" ? result.data.slice(0, 200) : JSON.stringify(result.data).slice(0, 200),
      });

      let robotsData: { success?: boolean; activeRobots?: number; totalConnections?: number; clientConnections?: number; monitorConnections?: number; robotPresenceEntries?: Array<{ robotId: string; connectionId: string; status: string; updatedAt: number | null }>; connTableEntries?: Array<{ connectionId: string; kind: string; ts: number | null }> } | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            robotsData = JSON.parse(firstParse);
          } else {
            robotsData = firstParse;
          }
        } catch (e) {
          logger.error("❌ Failed to parse JSON response:", e);
          robotsData = { success: false };
        }
      } else {
        robotsData = result.data as typeof robotsData;
      }

      logger.log("[CONN_CLEANUP_DEBUG] Parsed robotsData:", {
        hasData: !!robotsData,
        success: robotsData?.success,
        activeRobots: robotsData?.activeRobots,
        robotPresenceEntriesType: typeof robotsData?.robotPresenceEntries,
        robotPresenceEntriesIsArray: Array.isArray(robotsData?.robotPresenceEntries),
        robotPresenceEntriesLength: robotsData?.robotPresenceEntries?.length ?? "n/a",
        robotPresenceEntriesSample: robotsData?.robotPresenceEntries?.slice?.(0, 2),
        fullKeys: robotsData ? Object.keys(robotsData) : [],
      });

      if (robotsData && (robotsData.success || robotsData.activeRobots !== undefined)) {
        setActiveRobots({
          activeRobots: robotsData.activeRobots ?? 0,
          totalConnections: robotsData.totalConnections ?? 0,
          clientConnections: robotsData.clientConnections ?? 0,
          monitorConnections: robotsData.monitorConnections ?? 0,
          robotPresenceEntries: robotsData.robotPresenceEntries ?? [],
          connTableEntries: robotsData.connTableEntries ?? [],
        });
      }
    } catch (err) {
      logger.error("❌ Error loading active robots:", err);
      setActiveRobots(null);
    } finally {
      // Loading complete
    }
  };

  const handleTriggerCleanup = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      return;
    }

    setTriggeringCleanup(true);
    try {
      logger.log("🧹 Triggering connection cleanup...");
      const result = await client.mutations.triggerConnectionCleanupLambda();

      let cleanupData: { success?: boolean; statusCode?: number; body?: string; message?: string; result?: { statusCode?: number; body?: string }; stats?: { cleanedConnections?: number; staleConnections?: number } } | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            cleanupData = JSON.parse(firstParse);
          } else {
            cleanupData = firstParse;
          }
        } catch (e) {
          logger.error("❌ Failed to parse JSON response:", e);
          cleanupData = { success: false };
        }
      } else {
        cleanupData = result.data as typeof cleanupData;
      }

      if (cleanupData?.body && typeof cleanupData.body === 'string') {
        try {
          const parsedBody = JSON.parse(cleanupData.body);
          cleanupData = { ...cleanupData, ...parsedBody };
        } catch {
          // ignore
        }
      }

      let resultBody: { message?: string; stats?: { staleConnections?: number; cleanedConnections?: number } } | null = null;
      if (cleanupData?.result?.body) {
        try {
          resultBody = typeof cleanupData.result.body === 'string' ? JSON.parse(cleanupData.result.body) : cleanupData.result.body;
        } catch {
          resultBody = null;
        }
      }
      const stats = resultBody?.stats ?? cleanupData?.stats;
      const message = resultBody?.message ?? cleanupData?.message ?? '';
      const isSuccess = cleanupData?.success === true || cleanupData?.statusCode === 200 || cleanupData?.result?.statusCode === 200;

      if (isSuccess) {
        logger.log("✅ Cleanup completed:", message, stats);
        const feedback = stats?.cleanedConnections
          ? `Cleaned ${stats.cleanedConnections} stale connection(s).`
          : stats?.staleConnections === 0
            ? "No stale connections (all connections < 1 hour old or none exist)."
            : message || "Cleanup completed.";
        setLastCleanupMessage(feedback);
        if (stats?.staleConnections === 0 && stats?.cleanedConnections === 0) {
          logger.warn("⚠️ No stale connections found. All connections may be recent (< 1 hour old).");
        }
        await loadActiveRobots();
      } else {
        logger.warn("⚠️ Cleanup response unexpected (no success flag):", cleanupData);
        setLastCleanupMessage("Cleanup ran but response format was unexpected.");
        await loadActiveRobots();
      }
    } catch (err) {
      logger.error("❌ Error triggering cleanup:", err);
    } finally {
      setTriggeringCleanup(false);
    }
  };

  useEffect(() => {
    loadActiveRobots();
  }, [user?.email]);

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faBroom} className="section-icon" />
        <h2>Connection Cleanup</h2>
      </div>
      <div className="section-content">
        <p className="section-description">
          Manually trigger cleanup of stale WebSocket connections. The cleanup job automatically runs every hour,
          but you can trigger it manually if needed. This removes dead connections and updates robot online status.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="admin-button admin-button-primary"
              onClick={handleTriggerCleanup}
              disabled={triggeringCleanup}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <FontAwesomeIcon icon={triggeringCleanup ? faSync : faBroom} spin={triggeringCleanup} />
              {triggeringCleanup ? 'Running Cleanup...' : 'Trigger Cleanup Now'}
            </button>
            {activeRobots && (
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>
                <strong>Active:</strong> {activeRobots.activeRobots ?? 0} robots, {activeRobots.totalConnections ?? 0} total connections
                {(activeRobots.clientConnections ?? 0) > 0 && ` (${activeRobots.clientConnections} clients, ${activeRobots.monitorConnections ?? 0} monitors)`}
              </div>
            )}
            {lastCleanupMessage && (
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                {lastCleanupMessage}
              </div>
            )}
          </div>

          {activeRobots && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
              <div>
                <h4 style={{ marginBottom: '0.5rem', fontSize: '0.95rem' }}>Connections Table (CONN_TABLE)</h4>
                {(activeRobots.totalConnections ?? 0) > 10 && (
                  <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.25rem' }}>
                    Showing first 10 of {activeRobots.totalConnections}
                  </p>
                )}
                <div style={{ overflowX: 'auto', maxHeight: '200px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px' }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Connection ID</th>
                        <th>Kind</th>
                        <th>Connected At (ts)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeRobots.connTableEntries?.length ?? 0) > 0 ? (
                        (activeRobots.connTableEntries ?? []).map((entry, idx) => (
                          <tr key={idx}>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} title={entry.connectionId}>{entry.connectionId.slice(0, 12)}...</td>
                            <td>{entry.kind || '—'}</td>
                            <td>{entry.ts ? new Date(entry.ts).toLocaleString() : '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} style={{ color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>
                            No entries
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h4 style={{ marginBottom: '0.5rem', fontSize: '0.95rem' }}>Robot Presence Table (ROBOT_PRESENCE_TABLE)</h4>
                {(activeRobots.activeRobots ?? 0) > 20 && (
                  <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.25rem' }}>
                    Showing first 20 of {activeRobots.activeRobots}
                  </p>
                )}
                <div style={{ overflowX: 'auto', maxHeight: '200px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px' }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Robot ID</th>
                        <th>Connection ID</th>
                        <th>Status</th>
                        <th>Updated At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeRobots.robotPresenceEntries?.length ?? 0) > 0 ? (
                        (activeRobots.robotPresenceEntries ?? []).map((entry, idx) => (
                          <tr key={idx}>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{entry.robotId}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} title={entry.connectionId}>{entry.connectionId.slice(0, 12)}...</td>
                            <td>{entry.status}</td>
                            <td>{entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} style={{ color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>
                            No entries
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

