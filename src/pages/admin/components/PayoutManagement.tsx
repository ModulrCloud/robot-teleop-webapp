import { useState, useEffect } from "react";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDollarSign,
  faChartLine,
  faInfoCircle,
  faChevronLeft,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import { logger } from "../../../utils/logger";
import "../../Admin.css";
import type {
  Payout,
  PayoutsResponse,
  LambdaResponse,
  GraphQLError,
} from "../types";

const client = generateClient<Schema>();

export const PayoutManagement = () => {
  const { user } = useAuthStatus();
  
  // Payouts state
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loadingPayouts, setLoadingPayouts] = useState(false);
  const [payoutsPaginationToken, setPayoutsPaginationToken] = useState<string | null>(null);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<string>('pending');
  const [processingPayouts, setProcessingPayouts] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'earnings' | 'date'>('earnings'); // 'earnings' = highest first, 'date' = newest first
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadPayouts = async (token?: string | null, status?: string) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoadingPayouts(true);
    setError(null);
    try {
      const result = await client.queries.listPartnerPayoutsLambda({ 
        limit: 50,
        status: status || payoutStatusFilter || undefined,
        nextToken: token || undefined,
      });
      
      let payoutsData: PayoutsResponse | null = null;
      const raw = result.data;
      // Lambda returns { statusCode, body } where body is JSON string; Amplify may pass through as object or string
      if (typeof raw === 'string') {
        try {
          const firstParse = JSON.parse(raw);
          if (firstParse?.statusCode !== undefined && firstParse?.statusCode !== 200) {
            const errBody = typeof firstParse.body === 'string' ? JSON.parse(firstParse.body || '{}') : firstParse.body;
            setError(errBody?.error || `Request failed (${firstParse.statusCode})`);
            setPayouts([]);
            setPayoutsPaginationToken(null);
            return;
          }
          if (firstParse?.statusCode === 200 && firstParse?.body != null) {
            payoutsData = typeof firstParse.body === 'string' ? JSON.parse(firstParse.body) : firstParse.body;
          } else {
            payoutsData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
          }
        } catch (e) {
          payoutsData = { success: false };
        }
      } else if (raw && typeof raw === 'object') {
        const statusCode = (raw as { statusCode?: number }).statusCode;
        if (statusCode !== undefined && statusCode !== 200) {
          const body = (raw as { body?: string | object }).body;
          const errBody = typeof body === 'string' ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : (body || {});
          setError((errBody as { error?: string }).error || `Request failed (${statusCode})`);
          setPayouts([]);
          setPayoutsPaginationToken(null);
          return;
        }
        if (statusCode === 200 && (raw as { body?: unknown }).body != null) {
          const body = (raw as { body: string | object }).body;
          try {
            payoutsData = typeof body === 'string' ? JSON.parse(body) : body as PayoutsResponse;
          } catch (e) {
            payoutsData = { success: false };
          }
        } else {
          payoutsData = raw as PayoutsResponse;
        }
      }

      if (payoutsData?.success && payoutsData.payouts) {
        // Sort payouts: by earnings (highest first) or by date (newest first)
        const sortedPayouts = [...payoutsData.payouts].sort((a, b) => {
          if (sortBy === 'earnings') {
            // Sort by creditsEarnedDollars (highest first)
            return (b.creditsEarnedDollars || 0) - (a.creditsEarnedDollars || 0);
          } else {
            // Sort by date (newest first)
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
          }
        });
        setPayouts(sortedPayouts);
        setPayoutsPaginationToken(payoutsData.nextToken || null);
      } else {
        setPayouts([]);
        setPayoutsPaginationToken(null);
        // No threshold: list returns all matching payouts. Empty = no pending or API returned non-success.
        if (payoutsData && !payoutsData.success) {
          setError("Payout list request did not succeed. Check console for details.");
        }
      }
    } catch (err) {
      logger.error("Failed to load payouts:", err);
      setError("Failed to load payouts");
      setPayouts([]);
    } finally {
      setLoadingPayouts(false);
    }
  };

  useEffect(() => {
    if (user?.email && hasAdminAccess(user.email)) {
      loadPayouts(null, payoutStatusFilter);
    }
    // Re-run when user becomes available (auth can resolve after mount) or filter changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutStatusFilter, user?.email]);

  const handlePayoutsNextPage = () => {
    if (payoutsPaginationToken) {
      loadPayouts(payoutsPaginationToken, payoutStatusFilter);
    }
  };

  const handlePayoutsPrevPage = () => {
    setPayoutsPaginationToken(null);
    loadPayouts(null, payoutStatusFilter);
  };

  const handleProcessPayout = async (payoutId: string) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    setProcessingPayouts(prev => new Set(prev).add(payoutId));
    setError(null);
    setSuccess(null);

    try {
      logger.log("🔄 Processing payout:", payoutId);
      
      const result = await client.mutations.processPayoutLambda({
        payoutIds: [payoutId],
      });

      logger.log("📦 Raw result from processPayoutLambda:", result);

      // Parse the JSON response
      let resultData: LambdaResponse<{ success?: boolean; totalDollars?: number; processedCount?: number; error?: string }> | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            resultData = JSON.parse(firstParse);
          } else {
            resultData = firstParse;
          }
        } catch (e) {
          logger.error("Failed to parse result.data as JSON:", e, "Raw data:", result.data);
          setError(`Failed to parse response: ${result.data}`);
          return;
        }
      } else {
        resultData = result.data as any;
      }

      // Check for errors in the result
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e) => (e as unknown as GraphQLError).message || JSON.stringify(e)).join(', ');
        logger.error("❌ GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      if (resultData?.statusCode === 200) {
        const body = typeof resultData.body === 'string' ? JSON.parse(resultData.body) : resultData.body;
        if (body.success) {
          setSuccess(`Successfully processed payout: $${body.totalDollars?.toFixed(2) || '0.00'}`);
          // Reload payouts to reflect the updated status
          await loadPayouts(null, payoutStatusFilter);
        } else {
          setError(body.error || "Failed to process payout");
        }
      } else {
        const body = typeof resultData?.body === 'string' ? JSON.parse(resultData.body) : resultData?.body;
        setError(body?.error || "Failed to process payout");
      }
    } catch (err) {
      logger.error("❌ Error processing payout:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to process payout: ${errorMessage}`);
    } finally {
      setProcessingPayouts(prev => {
        const newSet = new Set(prev);
        newSet.delete(payoutId);
        return newSet;
      });
    }
  };

  const handleProcessMultiplePayouts = async (payoutIds: string[]) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    if (payoutIds.length === 0) {
      setError("No payouts selected");
      return;
    }

    // Add all IDs to processing set
    setProcessingPayouts(prev => {
      const newSet = new Set(prev);
      payoutIds.forEach(id => newSet.add(id));
      return newSet;
    });
    setError(null);
    setSuccess(null);

    try {
      logger.log("🔄 Processing multiple payouts:", payoutIds);
      
      const result = await client.mutations.processPayoutLambda({
        payoutIds,
      });

      logger.log("📦 Raw result from processPayoutLambda:", result);

      // Parse the JSON response
      let resultData: LambdaResponse<{ success?: boolean; totalDollars?: number; processedCount?: number; error?: string }> | null = null;
      if (typeof result.data === 'string') {
        try {
          const firstParse = JSON.parse(result.data);
          if (typeof firstParse === 'string') {
            resultData = JSON.parse(firstParse);
          } else {
            resultData = firstParse;
          }
        } catch (e) {
          logger.error("Failed to parse result.data as JSON:", e, "Raw data:", result.data);
          setError(`Failed to parse response: ${result.data}`);
          return;
        }
      } else {
        resultData = result.data as any;
      }

      // Check for errors in the result
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e) => (e as unknown as GraphQLError).message || JSON.stringify(e)).join(', ');
        logger.error("❌ GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      if (resultData?.statusCode === 200) {
        const body = typeof resultData.body === 'string' ? JSON.parse(resultData.body) : resultData.body;
        if (body.success) {
          setSuccess(`Successfully processed ${body.processedCount || 0} payout(s): $${body.totalDollars?.toFixed(2) || '0.00'}`);
          // Reload payouts to reflect the updated status
          await loadPayouts(null, payoutStatusFilter);
        } else {
          setError(body.error || "Failed to process payouts");
        }
      } else {
        const body = typeof resultData?.body === 'string' ? JSON.parse(resultData.body) : resultData?.body;
        setError(body?.error || "Failed to process payouts");
      }
    } catch (err) {
      logger.error("❌ Error processing payouts:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to process payouts: ${errorMessage}`);
    } finally {
      // Remove all IDs from processing set
      setProcessingPayouts(prev => {
        const newSet = new Set(prev);
        payoutIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    }
  };

  const handleExportPayouts = () => {
    if (payouts.length === 0) {
      setError("No payouts to export");
      return;
    }

    try {
      // Create CSV header
      const headers = [
        'Date',
        'Partner Email',
        'Partner ID',
        'Robot Name',
        'Robot ID',
        'Earnings ($)',
        'Platform Fee ($)',
        'Total Charged ($)',
        'Status',
        'Type',
        'Payout Date',
        'Session ID',
        'Reservation ID',
        'Duration (seconds)',
        'Duration (minutes)',
      ];

      // Create CSV rows
      const rows = payouts.map(payout => [
        payout.createdAt ? new Date(payout.createdAt).toISOString() : '',
        payout.partnerEmail || '',
        payout.partnerId || '',
        payout.robotName || '',
        payout.robotId || '',
        (payout.creditsEarnedDollars || 0).toFixed(2),
        (payout.platformFeeDollars || 0).toFixed(2),
        (payout.totalCreditsChargedDollars || 0).toFixed(2),
        payout.status || '',
        payout.reservationId ? 'Reservation' : payout.sessionId ? 'Session' : '',
        payout.payoutDate ? new Date(payout.payoutDate).toISOString() : '',
        payout.sessionId || '',
        payout.reservationId || '',
        payout.durationSeconds || '',
        payout.durationMinutes || '',
      ]);

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
      const statusLabel = payoutStatusFilter || 'all';
      link.setAttribute('href', url);
      link.setAttribute('download', `payouts_${statusLabel}_${timestamp}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSuccess("Payouts exported successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      logger.error("Failed to export payouts:", err);
      setError("Failed to export payouts");
    }
  };

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faDollarSign} className="section-icon" />
        <h2>Payout Management</h2>
      </div>
      <div className="section-content">
        {error && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>
            <FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: '0.5rem' }} />
            {error}
          </div>
        )}
        {success && (
          <div className="success-message" style={{ marginBottom: '1rem' }}>
            <FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: '0.5rem' }} />
            {success}
          </div>
        )}
        
        <p className="section-description">
          View and manage partner payouts. Process payouts when they reach $100 (10,000 credits) or more. Click "Mark as Paid" to process individual payouts.
        </p>
        
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {payouts.filter(p => p.status === 'pending').length > 0 && (
            <button
              className="admin-button admin-button-primary"
              onClick={() => {
                const pendingIds = payouts.filter(p => p.status === 'pending').map(p => p.id);
                if (pendingIds.length > 0) {
                  handleProcessMultiplePayouts(pendingIds);
                }
              }}
              disabled={processingPayouts.size > 0}
            >
              {processingPayouts.size > 0 
                ? `Processing ${processingPayouts.size} payout(s)...` 
                : `Process All Pending (${payouts.filter(p => p.status === 'pending').length})`}
            </button>
          )}
          
          <button
            className="admin-button admin-button-secondary"
            onClick={handleExportPayouts}
            disabled={payouts.length === 0 || loadingPayouts}
            style={{ marginLeft: 'auto' }}
          >
            <FontAwesomeIcon icon={faChartLine} style={{ marginRight: '0.5rem' }} />
            Export CSV
          </button>
        </div>
        
        <div className="payout-filters" style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            Filter by Status:
          </label>
          <select
            value={payoutStatusFilter}
            onChange={(e) => {
              setPayoutStatusFilter(e.target.value);
              setPayoutsPaginationToken(null);
            }}
          >
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All</option>
          </select>
          
          <label style={{ color: 'rgba(255, 255, 255, 0.7)', marginLeft: '1rem' }}>
            Sort by:
          </label>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as 'earnings' | 'date');
              // Re-sort existing payouts
              const sorted = [...payouts].sort((a, b) => {
                if (e.target.value === 'earnings') {
                  return (b.creditsEarnedDollars || 0) - (a.creditsEarnedDollars || 0);
                } else {
                  const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                  const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                  return dateB - dateA;
                }
              });
              setPayouts(sorted);
            }}
          >
            <option value="earnings">Highest Earnings First</option>
            <option value="date">Newest First</option>
          </select>
        </div>
        
        {loadingPayouts ? (
          <div className="loading-state">
            <p>Loading payouts...</p>
          </div>
        ) : (
          <div className="payouts-list">
            {payouts.length === 0 ? (
              <div className="empty-state">
                <FontAwesomeIcon icon={faInfoCircle} />
                <p>No payouts found.</p>
              </div>
            ) : (
              <>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Partner</th>
                      <th>Robot</th>
                      <th>Earnings</th>
                      <th>Platform Fee</th>
                      <th>Total Charged</th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((payout, index) => (
                      <tr key={payout.id || index}>
                        <td>{payout.createdAt ? new Date(payout.createdAt).toLocaleDateString() : 'N/A'}</td>
                        <td>{payout.partnerEmail || payout.partnerId || 'N/A'}</td>
                        <td>{payout.robotName || payout.robotId || 'N/A'}</td>
                        <td>${payout.creditsEarnedDollars?.toFixed(2) || '0.00'}</td>
                        <td>${payout.platformFeeDollars?.toFixed(2) || '0.00'}</td>
                        <td>${payout.totalCreditsChargedDollars?.toFixed(2) || '0.00'}</td>
                        <td>
                          <span className={`status-badge ${payout.status || 'pending'}`}>
                            {payout.status || 'pending'}
                          </span>
                        </td>
                        <td>{payout.reservationId ? 'Reservation' : payout.sessionId ? 'Session' : 'N/A'}</td>
                        <td>
                          {payout.status === 'pending' && (
                            <button
                              className="admin-button admin-button-primary"
                              onClick={() => handleProcessPayout(payout.id)}
                              disabled={processingPayouts.has(payout.id)}
                              style={{ 
                                padding: '0.25rem 0.5rem',
                                fontSize: '0.875rem',
                              }}
                            >
                              {processingPayouts.has(payout.id) ? 'Processing...' : 'Mark as Paid'}
                            </button>
                          )}
                          {payout.status === 'paid' && (
                            <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.875rem' }}>
                              Processed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {payouts.length > 0 && (
                  <div className="pagination-controls">
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={handlePayoutsPrevPage}
                      disabled={loadingPayouts || !payoutsPaginationToken}
                      title="Previous page"
                    >
                      <FontAwesomeIcon icon={faChevronLeft} />
                      Previous
                    </button>
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={handlePayoutsNextPage}
                      disabled={loadingPayouts || !payoutsPaginationToken}
                      title="Next page"
                    >
                      Next
                      <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

