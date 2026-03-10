import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCoins,
  faSortAmountDown,
  faSortAmountUp,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import { DatePicker } from "../../../components/DatePicker";
import "../../Admin.css";

const client = generateClient<Schema>();

export interface PlatformRevenueEntry {
  id?: string;
  createdAt?: string;
  transactionType?: string;
  amountCredits?: number;
  referenceId?: string;
  description?: string;
}

interface TimelineResponse {
  entries: PlatformRevenueEntry[];
  nextToken: string | null;
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  session_markup: "Session markup",
  certification_fee: "Certification fee",
};

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

function formatType(type?: string): string {
  if (!type) return "—";
  return TRANSACTION_TYPE_LABELS[type] ?? type;
}

export const PlatformRevenueTimeline = () => {
  const { user } = useAuthStatus();
  const [entries, setEntries] = useState<PlatformRevenueEntry[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  const loadEntries = useCallback(
    async (token?: string | null) => {
      if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await client.queries.listPlatformRevenueEntriesLambda({
          limit: 100,
          transactionType: typeFilter === "all" ? undefined : typeFilter,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          nextToken: token || undefined,
        });

        let data: TimelineResponse;
        if (typeof result.data === "string") {
          try {
            data = JSON.parse(result.data) as TimelineResponse;
          } catch (e) {
            logger.error("Failed to parse platform revenue response", e);
            setError("Failed to load revenue entries");
            return;
          }
        } else {
          data = result.data as TimelineResponse;
        }

        if (token) {
          setEntries((prev) => [...prev, ...(data.entries ?? [])]);
        } else {
          setEntries(data.entries ?? []);
        }
        setNextToken(data.nextToken ?? null);
      } catch (err) {
        logger.error("Error loading platform revenue entries", err);
        setError(err instanceof Error ? err.message : "Failed to load revenue entries");
        if (!token) setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [user?.email, user?.group, typeFilter, startDate, endDate]
  );

  useEffect(() => {
    loadEntries(null);
  }, [loadEntries]);

  const handleLoadMore = () => {
    if (nextToken) loadEntries(nextToken);
  };

  const displayEntries = [...entries];
  if (!sortNewestFirst) {
    displayEntries.reverse();
  }

  const canLoadMore = !!nextToken && !loading;

  if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
    return null;
  }

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faCoins} className="section-icon" />
        <h2>Platform revenue timeline</h2>
      </div>
      <p className="section-description">
        Revenue recorded by the platform (session markup and certification fees). Use filters to narrow by type or date.
      </p>

      <div className="section-content">
        <div className="admin-revenue-filters">
          <label className="admin-filter-group">
            <span className="admin-filter-label">Type</span>
            <select
              className="admin-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by transaction type"
            >
              <option value="all">All</option>
              <option value="session_markup">Session markup</option>
              <option value="certification_fee">Certification fee</option>
            </select>
          </label>
          <div className="admin-filter-group admin-revenue-date-picker">
            <DatePicker
              label="Start date"
              value={startDate}
              onChange={setStartDate}
              max={endDate || undefined}
              compact
            />
          </div>
          <div className="admin-filter-group admin-revenue-date-picker">
            <DatePicker
              label="End date"
              value={endDate}
              onChange={setEndDate}
              min={startDate || undefined}
              compact
            />
          </div>
          <button
            type="button"
            className="admin-button admin-button-secondary"
            onClick={() => setSortNewestFirst((v) => !v)}
            title={sortNewestFirst ? "Show oldest first" : "Show newest first"}
            aria-label={sortNewestFirst ? "Show oldest first" : "Show newest first"}
          >
            <FontAwesomeIcon icon={sortNewestFirst ? faSortAmountDown : faSortAmountUp} />
            {sortNewestFirst ? "Newest first" : "Oldest first"}
          </button>
        </div>

        {error && (
          <div className="admin-alert admin-alert-error" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}

        {loading && entries.length === 0 ? (
          <div className="loading-state">
            <p>Loading revenue entries...</p>
          </div>
        ) : displayEntries.length === 0 ? (
          <p className="section-description" style={{ marginTop: "1rem" }}>
            No revenue entries match the current filters.
          </p>
        ) : (
          <>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date / time</th>
                    <th>Type</th>
                    <th>Amount (credits)</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {displayEntries.map((entry) => (
                    <tr key={entry.id ?? entry.createdAt ?? String(Math.random())}>
                      <td>{formatDateTime(entry.createdAt)}</td>
                      <td>{formatType(entry.transactionType)}</td>
                      <td>{(entry.amountCredits ?? 0).toLocaleString()}</td>
                      <td>{entry.referenceId ?? "—"}</td>
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
    </div>
  );
};
