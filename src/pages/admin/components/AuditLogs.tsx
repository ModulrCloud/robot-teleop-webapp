import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHistory,
  faInfoCircle,
  faChevronLeft,
  faChevronRight,
  faDownload,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import "../../Admin.css";
import type {
  AuditLog,
  AuditLogsResponse,
} from "../types";

const client = generateClient<Schema>();

export const AuditLogs = () => {
  const { user } = useAuthStatus();
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [auditLogsPaginationToken, setAuditLogsPaginationToken] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async (token?: string | null) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingAuditLogs(true);
    try {
      logger.log("🔍 [AUDIT LOGS] Loading audit logs...", { token });
      logger.log("🔍 [AUDIT LOGS] Calling listAuditLogsLambda...");
      const result = await client.queries.listAuditLogsLambda({
        limit: 10, // 10 records per page
        paginationToken: token || undefined,
      });
      logger.log("🔍 [AUDIT LOGS] listAuditLogsLambda response received");
      logger.log("🔍 [AUDIT LOGS] Raw result:", JSON.stringify(result, null, 2));

      let logsData: AuditLogsResponse | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            logsData = JSON.parse(firstParse);
          } else {
            logsData = firstParse;
          }
        } catch (e) {
          logger.error("❌ Failed to parse JSON response:", e);
          logsData = { success: false };
        }
      } else {
        logsData = result.data as typeof logsData;
      }

      if (logsData?.success && logsData.auditLogs) {
        logger.log(`✅ [AUDIT LOGS] Loaded ${logsData.auditLogs.length} audit log(s)`);
        logger.log("✅ [AUDIT LOGS] Audit logs:", JSON.stringify(logsData.auditLogs, null, 2));
        setAuditLogs(logsData.auditLogs);
        setAuditLogsPaginationToken(logsData.nextToken || null);
      } else {
        logger.warn("⚠️ [AUDIT LOGS] No audit logs found or invalid response");
        logger.warn("⚠️ [AUDIT LOGS] logsData:", JSON.stringify(logsData, null, 2));
      }
    } catch (err) {
      logger.error("❌ Error loading audit logs:", err);
      setAuditLogs([]);
    } finally {
      setLoadingAuditLogs(false);
    }
  }, [user?.email]);

  const handleAuditLogsNextPage = () => {
    if (auditLogsPaginationToken) {
      loadAuditLogs(auditLogsPaginationToken);
    }
  };

  const handleAuditLogsPrevPage = () => {
    // Note: DynamoDB doesn't support backward pagination easily
    // For now, just reload from the beginning
    setAuditLogsPaginationToken(null);
    loadAuditLogs(null);
  };

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  // Listen for refresh event from other components (UserManagement, PlatformSettings, etc.)
  useEffect(() => {
    const handleRefresh = () => {
      logger.log("🔄 [AUDIT LOGS] Refresh event received, reloading audit logs...");
      loadAuditLogs();
    };
    
    window.addEventListener('refreshAuditLogs', handleRefresh);
    return () => window.removeEventListener('refreshAuditLogs', handleRefresh);
  }, [loadAuditLogs]);

  const handleExportCSV = () => {
    if (auditLogs.length === 0) {
      return;
    }

    try {
      // Create CSV header
      const headers = [
        'Timestamp',
        'Action',
        'Admin User ID',
        'Admin Email',
        'Target User ID',
        'Target Email',
        'Reason',
        'Metadata',
      ];

      // Create CSV rows
      const rows = auditLogs.map(log => {
        // Format action with details
        let actionDisplay = log.action || 'N/A';
        if (log.action === 'ADJUST_CREDITS' && log.metadata) {
          const creditsAmount = log.metadata.creditsAmount;
          if (creditsAmount !== undefined) {
            const action = creditsAmount > 0 ? 'Added' : 'Reduced';
            actionDisplay = `${action} ${Math.abs(creditsAmount).toLocaleString()} credits`;
          }
        } else if (log.action === 'DELETE_ROBOT' && log.metadata) {
          const robotName = log.metadata.robotName || 'Unknown Robot';
          actionDisplay = `Deleted robot "${robotName}"`;
        } else if (log.action === 'CHANGE_USER_CLASSIFICATION' && log.metadata) {
          const oldClass = log.metadata.oldClassification || 'Unknown';
          const newClass = log.metadata.newClassification || 'Unknown';
          actionDisplay = `Changed classification: ${oldClass} → ${newClass}`;
        } else if (log.action === 'CREATE_CREDIT_TIER' && log.metadata) {
          const tierName = log.metadata.tierName || 'Unknown Tier';
          actionDisplay = `Created credit tier: "${tierName}"`;
        } else if (log.action === 'UPDATE_CREDIT_TIER' && log.metadata) {
          const tierName = log.metadata.tierName || log.metadata.tierId || 'Unknown';
          actionDisplay = `Updated credit tier: "${tierName}"`;
        } else if (log.action === 'DELETE_CREDIT_TIER' && log.metadata) {
          const deletedTier = log.metadata.deletedTier;
          if (deletedTier && deletedTier.name) {
            actionDisplay = `Deleted credit tier: "${deletedTier.name}"`;
          } else {
            actionDisplay = `Deleted credit tier: ${log.metadata.tierId || 'Unknown'}`;
          }
        } else if (log.action === 'PROCESS_PAYOUT' && log.metadata) {
          actionDisplay = `Processed payout for ${log.metadata.partnerEmail || 'N/A'}`;
        }

        return [
          log.timestamp ? new Date(log.timestamp).toISOString() : '',
          actionDisplay,
          log.adminUserId || '',
          log.adminEmail || '',
          log.targetUserId || '',
          log.targetEmail || '',
          log.reason || '',
          log.metadata ? JSON.stringify(log.metadata) : '',
        ];
      });

      // Escape CSV values (handle commas, quotes, newlines)
      const escapeCsvValue = (value: unknown): string => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Combine headers and rows
      const csvContent = [
        headers.map(escapeCsvValue).join(','),
        ...rows.map(row => row.map(escapeCsvValue).join(','))
      ].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      const timestamp = new Date().toISOString().split('T')[0];
      link.setAttribute('href', url);
      link.setAttribute('download', `audit_logs_${timestamp}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error("Error exporting audit logs:", err);
    }
  };

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faHistory} className="section-icon" />
        <h2>Audit Log</h2>
        {auditLogs.length > 0 && (
          <button
            className="admin-button admin-button-secondary"
            onClick={handleExportCSV}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <FontAwesomeIcon icon={faDownload} />
            Export CSV
          </button>
        )}
      </div>
      <div className="section-content">
        <p className="section-description">
          All admin actions are logged here for security and compliance. This log can be integrated with blockchain in the future.
        </p>
        
        {loadingAuditLogs ? (
          <div className="loading-state">
            <p>Loading audit logs...</p>
          </div>
        ) : (
          <div className="audit-logs-list">
            {auditLogs.length === 0 ? (
              <div className="empty-state">
                <FontAwesomeIcon icon={faInfoCircle} />
                <p>No audit logs found.</p>
              </div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Admin</th>
                    <th>Target User</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log, index) => {
                    // Format action with details for ADJUST_CREDITS
                    let actionDisplay = log.action || 'N/A';
                    if (log.action === 'ADJUST_CREDITS' && log.metadata) {
                      const creditsAmount = log.metadata.creditsAmount;
                      if (creditsAmount !== undefined) {
                        const action = creditsAmount > 0 ? 'Added' : 'Reduced';
                        actionDisplay = `${action} ${Math.abs(creditsAmount).toLocaleString()} credits`;
                      }
                    } else if (log.action === 'DELETE_ROBOT' && log.metadata) {
                      const robotName = log.metadata.robotName || 'Unknown Robot';
                      actionDisplay = `Deleted robot "${robotName}"`;
                    } else if (log.action === 'CHANGE_USER_CLASSIFICATION' && log.metadata) {
                      const oldClass = log.metadata.oldClassification || 'Unknown';
                      const newClass = log.metadata.newClassification || 'Unknown';
                      actionDisplay = `Changed classification: ${oldClass} → ${newClass}`;
                    } else if (log.action === 'CREATE_CREDIT_TIER' && log.metadata) {
                      const tierName = log.metadata.tierName || 'Unknown Tier';
                      actionDisplay = `Created credit tier: "${tierName}"`;
                    } else if (log.action === 'UPDATE_CREDIT_TIER' && log.metadata) {
                      const tierName = log.metadata.tierName || log.metadata.tierId || 'Unknown';
                      actionDisplay = `Updated credit tier: "${tierName}"`;
                    } else if (log.action === 'DELETE_CREDIT_TIER' && log.metadata) {
                      const deletedTier = log.metadata.deletedTier;
                      if (deletedTier && deletedTier.name) {
                        actionDisplay = `Deleted credit tier: "${deletedTier.name}"`;
                      } else {
                        actionDisplay = `Deleted credit tier: ${log.metadata.tierId || 'Unknown'}`;
                      }
                    }
                    
                    return (
                      <tr key={index}>
                        <td>{log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}</td>
                        <td>
                          <span className="action-badge">{actionDisplay}</span>
                          {log.metadata && (
                            <div className="action-metadata">
                              {log.metadata.robotName && log.metadata.robotModel && (
                                <span>Model: {log.metadata.robotModel}</span>
                              )}
                              {log.metadata.oldBalance !== undefined && log.metadata.newBalance !== undefined && (
                                <span>Balance: {log.metadata.oldBalance} &rarr; {log.metadata.newBalance}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td>{log.adminEmail || log.adminUserId || 'N/A'}</td>
                        <td>{log.targetEmail || log.targetUserId || 'N/A'}</td>
                        <td>{log.reason || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {auditLogs.length > 0 && (
              <div className="pagination-controls">
                <button
                  className="admin-button admin-button-secondary"
                  onClick={handleAuditLogsPrevPage}
                  disabled={loadingAuditLogs}
                  title="Reload from beginning"
                >
                  <FontAwesomeIcon icon={faChevronLeft} />
                  <span>Previous</span>
                </button>
                <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>
                  Showing {auditLogs.length} record{auditLogs.length !== 1 ? 's' : ''}
                </span>
                <button
                  className="admin-button admin-button-secondary"
                  onClick={handleAuditLogsNextPage}
                  disabled={!auditLogsPaginationToken || loadingAuditLogs}
                >
                  <span>Next</span>
                  <FontAwesomeIcon icon={faChevronRight} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

