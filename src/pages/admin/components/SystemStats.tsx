import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartLine,
  faUsers,
  faRobot,
  faDollarSign,
  faCoins,
  faPercent,
  faHistory,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import "../../Admin.css";
import type {
  SystemStats as SystemStatsType,
  SystemStatsResponse,
} from "../types";

const client = generateClient<Schema>();

/** Abbreviates large numbers (e.g. 118901 → "119k") to prevent card overflow. Tooltip shows full value. */
function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const SystemStats = () => {
  const { user } = useAuthStatus();
  const [systemStats, setSystemStats] = useState<SystemStatsType | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const loadSystemStats = async () => {
    logger.debug("🔍 [SYSTEM STATS] loadSystemStats called");
    
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
      logger.debug("🔍 [SYSTEM STATS] User doesn't have admin access, skipping");
      return;
    }

    setLoadingStats(true);
    try {
      logger.log("🔍 [SYSTEM STATS] Calling getSystemStatsLambda...");
      const result = await client.queries.getSystemStatsLambda();
      logger.debug("📊 [SYSTEM STATS] Raw result from Lambda:", result);

      let statsData: SystemStatsResponse | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            statsData = JSON.parse(firstParse);
          } else {
            statsData = firstParse;
          }
        } catch (e) {
          logger.error("❌ [SYSTEM STATS] Failed to parse JSON:", e);
          setSystemStats(null);
          return;
        }
      } else {
        statsData = result.data as typeof statsData;
      }

      logger.debug("📈 [SYSTEM STATS] Parsed stats data:", statsData);

      if (statsData?.success && statsData.stats) {
        // Extract the stats object and ensure all values are numbers
        const stats = {
          totalUsers: statsData.stats.totalUsers ?? 0,
          totalRobots: statsData.stats.totalRobots ?? 0,
          totalRevenue: statsData.stats.totalRevenue ?? 0,
          platformRevenue: statsData.stats.platformRevenue ?? 0,
          platformMarkupPercent: statsData.stats.platformMarkupPercent ?? 30,
          totalCredits: statsData.stats.totalCredits ?? 0,
          activeSessions: statsData.stats.activeSessions ?? 0,
          robotsOnline: statsData.stats.robotsOnline ?? 0,
        };
        logger.log("✅ Setting system stats:", stats);
        setSystemStats(stats);
      } else {
        logger.error("❌ [SYSTEM STATS] Invalid response:", statsData);
        setSystemStats(null);
      }
    } catch (err) {
      logger.error("❌ [SYSTEM STATS] Error loading stats:", err);
      setSystemStats(null);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    loadSystemStats();
  }, [user?.email]);

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faChartLine} className="section-icon" />
        <h2>System Statistics</h2>
      </div>
      <div className="section-content">
        {loadingStats ? (
          <div className="loading-state">
            <p>Loading statistics...</p>
          </div>
        ) : systemStats ? (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faUsers} />
              </div>
              <div className="stat-content">
                <div className="stat-value">{systemStats.totalUsers || 'N/A'}</div>
                <div className="stat-label">Total Users</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faRobot} />
              </div>
              <div className="stat-content">
                <div className="stat-value">
                  {systemStats.totalRobots !== undefined && systemStats.totalRobots !== null 
                    ? systemStats.totalRobots 
                    : 'N/A'}
                </div>
                <div className="stat-label">Total Robots</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faDollarSign} />
              </div>
              <div className="stat-content">
                <div className="stat-value stat-value-with-tooltip" title={`$${(systemStats.totalRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>
                  ${(systemStats.totalRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="stat-label">Total Revenue</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faCoins} />
              </div>
              <div className="stat-content">
                <div className="stat-value stat-value-with-tooltip" title={`$${(systemStats.platformRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>
                  ${(systemStats.platformRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="stat-label">Platform Balance</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faPercent} />
              </div>
              <div className="stat-content">
                <div className="stat-value">
                  {systemStats.platformMarkupPercent != null ? `${systemStats.platformMarkupPercent}%` : '30%'}
                </div>
                <div className="stat-label">Platform Cut</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faCoins} />
              </div>
              <div className="stat-content">
                <div className="stat-value stat-value-with-tooltip" title={(systemStats.totalCredits ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}>
                  {formatCompactNumber(systemStats.totalCredits ?? 0)}
                </div>
                <div className="stat-label">Total Credits</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faRobot} style={{ color: '#ffc107' }} />
              </div>
              <div className="stat-content">
                <div className="stat-value">
                  {systemStats.robotsOnline ?? 'N/A'}
                </div>
                <div className="stat-label">Robots Online</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">
                <FontAwesomeIcon icon={faHistory} />
              </div>
              <div className="stat-content">
                <div className="stat-value">{systemStats.activeSessions || '0'}</div>
                <div className="stat-label">Active Sessions</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <FontAwesomeIcon icon={faInfoCircle} />
            <p>Failed to load statistics</p>
          </div>
        )}
      </div>
    </div>
  );
};

