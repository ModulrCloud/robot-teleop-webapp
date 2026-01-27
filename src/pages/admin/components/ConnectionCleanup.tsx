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
  const [activeRobots, setActiveRobots] = useState<any | null>(null);
  const [triggeringCleanup, setTriggeringCleanup] = useState(false);

  const loadActiveRobots = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    // Loading state handled internally
    try {
      logger.log("🔍 Loading active robots...");
      const result = await client.queries.getActiveRobotsLambda();

      let robotsData: { success?: boolean; activeRobots?: number; totalConnections?: number; clientConnections?: number; monitorConnections?: number } | null = null;
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

      if (robotsData?.success) {
        setActiveRobots({
          activeRobots: robotsData.activeRobots || 0,
          totalConnections: robotsData.totalConnections || 0,
          clientConnections: robotsData.clientConnections || 0,
          monitorConnections: robotsData.monitorConnections || 0,
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
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setTriggeringCleanup(true);
    try {
      logger.log("🧹 Triggering connection cleanup...");
      const result = await client.mutations.triggerConnectionCleanupLambda();

      let cleanupData: { success?: boolean; message?: string; stats?: { cleaned?: number; active?: number } } | null = null;
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

      if (cleanupData?.success) {
        logger.log("✅ Cleanup triggered successfully:", cleanupData);
        // Reload active robots after cleanup
        await loadActiveRobots();
      } else {
        logger.error("❌ Cleanup failed:", cleanupData);
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
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
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
              <strong>Active:</strong> {activeRobots.activeRobots || 0} robots, {activeRobots.totalConnections || 0} total connections
              {activeRobots.clientConnections > 0 && ` (${activeRobots.clientConnections} clients, ${activeRobots.monitorConnections || 0} monitors)`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

