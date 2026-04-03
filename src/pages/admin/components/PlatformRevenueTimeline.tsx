import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCoins,
  faSortAmountDown,
  faSortAmountUp,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { useUserCredits } from "../../../hooks/useUserCredits";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import { formatCreditsAsCurrencySync, type CurrencyCode } from "../../../utils/credits";
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

/** Parse Lambda response (handles wrapped { statusCode, body } or double-encoded string). */
function parseTimelineResponse(raw: string | TimelineResponse | Record<string, unknown> | null | undefined): TimelineResponse {
  if (raw == null) return { entries: [], nextToken: null };
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { entries: [], nextToken: null };
  }
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return { entries: [], nextToken: null };
    }
  }
  if (parsed != null && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const bodyRaw = obj.body ?? obj.Body;
    if (bodyRaw !== undefined) {
      const payload: TimelineResponse | null =
        typeof bodyRaw === "string"
          ? (() => {
              try {
                return JSON.parse(bodyRaw) as unknown as TimelineResponse;
              } catch {
                return null;
              }
            })()
          : (bodyRaw as unknown as TimelineResponse);
      if (payload && Array.isArray(payload.entries)) return payload;
    }
    if (Array.isArray(obj.entries)) {
      return obj as unknown as TimelineResponse;
    }
  }
  return { entries: [], nextToken: null };
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  session_markup: "Session markup",
  certification_fee: "Certification fee",
};

/** Chart colors in order: brand yellow first, then palette for additional revenue types. */
const REVENUE_CHART_PALETTE = [
  "#ffc107", // brand yellow (Session markup)
  "#A8A8B3",
  "#1A8A7A",
  "#E8850C",
  "#3B9DD9",
  "#2DB86A",
];

/** Revenue series shown on the chart, in display order (legend and lines). Add new types here. */
const REVENUE_CHART_SERIES = ["Session markup", "Certification fee"] as const;

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

/** First day of current month as YYYY-MM-DD. */
function firstDayOfThisMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** Last day of current month as YYYY-MM-DD. */
function lastDayOfThisMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(last).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

type ChartDatum = { date: string; "Session markup": number; "Certification fee": number; total: number };

/** Placeholder chart data (all zeros) for each day in [start, end] so the chart always shows the range. */
function emptyChartDataForRange(start: string, end: string): ChartDatum[] {
  if (!start || !end || start > end) return [];
  const out: ChartDatum[] = [];
  const cur = new Date(start + "Z");
  const endD = new Date(end + "Z");
  while (cur <= endD) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    out.push({ date: `${y}-${m}-${d}`, "Session markup": 0, "Certification fee": 0, total: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Get YYYY-MM-DD in the user's local timezone so chart matches table (table uses toLocaleString). */
function toLocalDateString(iso: string | number | null | undefined): string {
  const raw = iso != null ? String(iso) : "";
  if (!raw || raw === "undefined") return "";
  try {
    const d = new Date(iso as string | number);
    if (Number.isNaN(d.getTime())) return raw.length >= 10 ? raw.slice(0, 10) : "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return raw.length >= 10 ? raw.slice(0, 10) : "";
  }
}

/** Aggregate entries by calendar day (local date) for the revenue-over-time chart. */
function aggregateRevenueByDay(entries: PlatformRevenueEntry[]): { date: string; "Session markup": number; "Certification fee": number; total: number }[] {
  const byDay = new Map<string, { session_markup: number; certification_fee: number }>();
  for (const e of entries) {
    const day = toLocalDateString(e.createdAt);
    if (!day) continue;
    const current = byDay.get(day) ?? { session_markup: 0, certification_fee: 0 };
    const credits = e.amountCredits ?? 0;
    if (e.transactionType === "session_markup") {
      current.session_markup += credits;
    } else if (e.transactionType === "certification_fee") {
      current.certification_fee += credits;
    }
    byDay.set(day, current);
  }
  return Array.from(byDay.entries())
    .map(([date, v]) => ({
      date,
      "Session markup": v.session_markup,
      "Certification fee": v.certification_fee,
      total: v.session_markup + v.certification_fee,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Merge aggregated-by-day data with full date range. Includes shifted local-day buckets outside [start, end] so boundary entries are not dropped. */
function chartDataWithFullRange(
  chartData: ChartDatum[],
  startDate: string,
  endDate: string
): ChartDatum[] {
  const fullRange = emptyChartDataForRange(startDate, endDate);
  const byDay = new Map(chartData.map((d) => [d.date, d]));
  const rangeSet = new Set(fullRange.map((r) => r.date));
  const mergedRange =
    fullRange.length === 0
      ? []
      : fullRange.map((row) => {
          const found = byDay.get(row.date);
          return found ? { ...row, ...found } : row;
        });
  const shiftedBuckets = chartData.filter((d) => !rangeSet.has(d.date));
  const combined = [...shiftedBuckets, ...mergedRange].sort((a, b) => a.date.localeCompare(b.date));
  return combined;
}

export const PlatformRevenueTimeline = () => {
  const { user } = useAuthStatus();
  const { currency: userCurrency, exchangeRates } = useUserCredits();
  const [entries, setEntries] = useState<PlatformRevenueEntry[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>(() => firstDayOfThisMonth());
  const [endDate, setEndDate] = useState<string>(() => lastDayOfThisMonth());
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const fetchIdRef = useRef(0);

  const loadEntries = useCallback(
    async (token?: string | null) => {
      if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) {
        return;
      }

      const thisFetchId = fetchIdRef.current + 1;
      fetchIdRef.current = thisFetchId;

      setLoading(true);
      setError(null);
      try {
        // P1: Normalize endDate to end-of-day so entries on the selected end date are included
        const endDateParam = endDate
          ? `${endDate}T23:59:59.999Z`
          : undefined;

        const result = await client.queries.listPlatformRevenueEntriesLambda({
          limit: 100,
          transactionType: typeFilter === "all" ? undefined : typeFilter,
          startDate: startDate || undefined,
          endDate: endDateParam,
          nextToken: token || undefined,
        });

        // P2: Treat null payload or GraphQL errors as fetch failure so we don't show empty as success
        if (result.data == null || (result.errors && result.errors.length > 0)) {
          if (fetchIdRef.current !== thisFetchId) return;
          const errMsg =
            result.errors?.[0]?.message ?? (result.data == null ? "No data returned" : "Request failed");
          setError(errMsg);
          if (!token) setEntries([]);
          setNextToken(null);
          return;
        }

        const raw =
          typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data);
        const data = parseTimelineResponse(raw);

        if (fetchIdRef.current !== thisFetchId) return;

        if (token) {
          setEntries((prev) => [...prev, ...(data.entries ?? [])]);
        } else {
          setEntries(data.entries ?? []);
        }
        setNextToken(data.nextToken ?? null);
      } catch (err) {
        logger.error("Error loading platform revenue entries", err);
        if (fetchIdRef.current !== thisFetchId) return;
        setError(err instanceof Error ? err.message : "Failed to load revenue entries");
        if (!token) setEntries([]);
      } finally {
        if (fetchIdRef.current === thisFetchId) setLoading(false);
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

  const chartData = useMemo(() => aggregateRevenueByDay(entries), [entries]);
  const displayChartData = useMemo(
    () => chartDataWithFullRange(chartData, startDate, endDate),
    [chartData, startDate, endDate]
  );
  const canLoadMore = !!nextToken && !loading;
  const currency = (userCurrency ?? "USD") as CurrencyCode;

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

        {displayChartData.length > 0 && (
          <div className="admin-revenue-chart">
            <h3 className="admin-revenue-chart-title">Revenue over time (by day, local date)</h3>
            {chartData.length === 0 && (
              <p className="admin-revenue-chart-empty">No revenue in this period.</p>
            )}
            {chartData.length > 0 && nextToken && (
              <p className="admin-revenue-chart-empty">Chart based on first {entries.length} entries. Use &quot;Load more&quot; below for the full list.</p>
            )}
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={displayChartData}
                margin={{ top: 12, right: 12, left: 0, bottom: 28 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis
                  dataKey="date"
                  interval={displayChartData.length > 14 ? 2 : 0}
                  tick={{
                    fill: "rgba(255,255,255,0.7)",
                    fontSize: 11,
                    angle: -40,
                    textAnchor: "end",
                  }}
                  tickFormatter={(v) => {
                    try {
                      // Treat YYYY-MM-DD as local date so label matches table (no UTC shift)
                      const [y, m, d] = String(v).split("-");
                      if (y && m && d) {
                        const local = new Date(Number(y), Number(m) - 1, Number(d));
                        return local.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      }
                      return String(v);
                    } catch {
                      return String(v);
                    }
                  }}
                  axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatCreditsAsCurrencySync(v, currency, exchangeRates)}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(255,193,7,0.4)", strokeWidth: 1 }}
                  itemSorter={(item) => {
                    const key = (item?.dataKey ?? item?.name ?? "") as string;
                    const i = REVENUE_CHART_SERIES.indexOf(key as (typeof REVENUE_CHART_SERIES)[number]);
                    return i === -1 ? 999 : i;
                  }}
                  contentStyle={{
                    background: "rgba(26,26,26,0.98)",
                    border: "1px solid rgba(255,193,7,0.3)",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  labelFormatter={(label) => {
                    const [y, m, d] = String(label).split("-");
                    if (y && m && d) {
                      const local = new Date(Number(y), Number(m) - 1, Number(d));
                      return local.toLocaleDateString(undefined, { dateStyle: "medium" });
                    }
                    return String(label);
                  }}
                  formatter={(value: unknown, name: unknown) => [formatCreditsAsCurrencySync(typeof value === "number" ? value : 0, currency, exchangeRates), String(name ?? "")]}
                  labelStyle={{ color: "#ffc107" }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: "8px" }}
                  itemSorter={(item: { dataKey?: unknown; value?: unknown }) => {
                    if (item == null) return 999;
                    const key = String(item.dataKey ?? item.value ?? "");
                    const i = REVENUE_CHART_SERIES.indexOf(key as (typeof REVENUE_CHART_SERIES)[number]);
                    return i === -1 ? 999 : i;
                  }}
                  formatter={(value) => <span style={{ color: "rgba(255,255,255,0.85)" }}>{value}</span>}
                />
                {/* Render lines in reverse order so first series (Session markup) is drawn on top */}
                {[...REVENUE_CHART_SERIES].reverse().map((dataKey, reversedIndex) => {
                  const i = REVENUE_CHART_SERIES.length - 1 - reversedIndex;
                  const color = REVENUE_CHART_PALETTE[i] ?? REVENUE_CHART_PALETTE[0];
                  return (
                    <Line
                      key={dataKey}
                      type="monotone"
                      dataKey={dataKey}
                      name={dataKey}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ fill: color, strokeWidth: 0 }}
                      activeDot={{ r: 4, fill: color, stroke: "rgba(255,255,255,0.5)" }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

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
                    <th>Amount</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {displayEntries.map((entry) => (
                    <tr key={entry.id ?? entry.createdAt ?? String(Math.random())}>
                      <td>{formatDateTime(entry.createdAt)}</td>
                      <td>{formatType(entry.transactionType)}</td>
                      <td>{formatCreditsAsCurrencySync(entry.amountCredits ?? 0, currency, exchangeRates)}</td>
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
