"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import pageStyles from "../page.module.css";
import styles from "./Calendar.module.css";

type PnLData = Record<number, number>;

interface SyncStatus {
  queryId: string;
  lastSuccessAt: string | null;
  lastWindowTo: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  tradesSeen: number;
}

interface SyncResult {
  status: "ok" | "skipped" | "error";
  reason?: "fresh" | "in_progress" | "not_configured" | "rate_limited";
  message?: string;
  tradesUpserted: number;
  syncStatus: SyncStatus;
}

type AssetClassFilter = "all" | "OPT" | "STK";
type DisplayCurrency = "USD" | "SGD";

// Mirrors COOLDOWN_MS in src/lib/trades/sync.ts. The server is the source of
// truth — this constant only powers the disabled-button countdown so the user
// isn't left clicking a button that always returns "skipped".
const COOLDOWN_MS = 10 * 60 * 1000;

export function CalendarButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={pageStyles.railActionBtn}
        onClick={() => setOpen(true)}
        aria-label="Open PnL calendar"
      >
        <span className={pageStyles.railActionBtnIcon}>🗓</span>
        <span className={pageStyles.railActionBtnLabel}>PnL Calendar</span>
        <span className={pageStyles.railActionBtnHint}>Daily breakdown</span>
      </button>
      {open && <CalendarModal onClose={() => setOpen(false)} />}
    </>
  );
}

function daysSinceIso(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

// Server skips a sync attempt when last_attempt_at is within COOLDOWN_MS and
// no successful sync has happened since. We replicate that locally so the UI
// can disable the button + show a countdown instead of letting the user click
// it just to get back a "skipped" response.
function computeCooldownRemainingMs(
  sync: SyncStatus | null,
  now: number
): number {
  if (!sync?.lastAttemptAt) return 0;
  const attempt = new Date(sync.lastAttemptAt).getTime();
  if (sync.lastSuccessAt) {
    const success = new Date(sync.lastSuccessAt).getTime();
    if (success >= attempt) return 0;
  }
  return Math.max(0, COOLDOWN_MS - (now - attempt));
}

function CalendarModal({ onClose }: { onClose: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1); // 1-indexed
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("all");
  const [data, setData] = useState<PnLData>({});
  const [baseData, setBaseData] = useState<PnLData>({});
  const [loading, setLoading] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  // Drives the live cooldown countdown without re-fetching the sync row.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/trades/pnl?year=${year}&month=${month}&assetClass=${assetClass}`
      );
      if (res.ok) {
        const json = await res.json();
        setData(json.data || {});
        setBaseData(json.baseData || {});
        setSync(json.sync ?? null);
      }
    } catch (err) {
      console.error("Failed to fetch calendar PnL", err);
    } finally {
      setLoading(false);
    }
  }, [year, month, assetClass]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/trades/sync", { method: "POST" });
      const body = (await res.json().catch(() => null)) as SyncResult | null;
      if (body) setLastResult(body);
      // Surface non-2xx outcomes in the console too — banner makes it visible
      // in the UI, this makes it visible to anyone debugging via devtools.
      if (!res.ok) {
        console.error(`[flex-sync] HTTP ${res.status}`, body);
      }
      await fetchData();
    } catch (err) {
      console.error("[flex-sync] request threw", err);
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  // Initial DB read on open (no Flex call — sync is strictly manual now).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  // Tick once a second while the modal is open so the cooldown countdown
  // updates without us having to refetch the sync row.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);


  const cooldownRemaining = computeCooldownRemainingMs(sync, nowMs);
  const syncDisabled = syncing || cooldownRemaining > 0;

  // When SGD is selected, use the per-trade fxRateToBase values that came back
  // from the server (account base currency at trade time), keyed by day.
  const activeData = displayCurrency === "SGD" ? baseData : data;
  const toDisplay = (day: number) => activeData[day] ?? 0;

  const { totalPnl, cells } = useMemo(() => {
    const sum = Object.values(activeData).reduce((acc, val) => acc + val, 0);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const gridCells: { type: "empty" | "day"; day?: number }[] = [];
    for (let i = 0; i < firstDay; i++) gridCells.push({ type: "empty" });
    for (let d = 1; d <= daysInMonth; d++) {
      gridCells.push({ type: "day", day: d });
    }
    while (gridCells.length % 7 !== 0) gridCells.push({ type: "empty" });
    return { totalPnl: sum, cells: gridCells };
  }, [activeData, year, month]);

  const monthOptions = useMemo(() => {
    const opts: { year: number; month: number }[] = [];
    const now = new Date();
    const currentTotalMonths = now.getFullYear() * 12 + now.getMonth();
    for (let m = currentTotalMonths; m >= 2023 * 12; m--) {
      opts.push({ year: Math.floor(m / 12), month: (m % 12) + 1 });
    }
    return opts;
  }, []);

  const banner = useMemo(() => {
    if (!sync) return null;

    // Sync attempt actually hit IBKR and IBKR rejected us. Loud red banner;
    // include the raw upstream message so it's clear what's actually broken.
    if (lastResult?.status === "error" && lastResult.reason === "rate_limited") {
      return {
        kind: "error" as const,
        text: `Sync rejected by IBKR (${lastResult.message ?? "rate-limited"}). Either wait for IBKR's per-token cooldown (often 24h) or create a new Flex Query in IBKR Account Management and update IBKR_FLEX_QUERY_ID.`,
      };
    }

    // Generic upstream error stamped in the DB (bad token, query not found).
    if (sync.lastError) {
      return { kind: "error" as const, text: `Sync failed: ${sync.lastError}` };
    }

    const days = daysSinceIso(sync.lastSuccessAt);
    if (days === null) {
      return {
        kind: "warn" as const,
        text: syncing
          ? "Syncing trades from IBKR — first pull can take 5–30s…"
          : "No trades synced yet. Click Sync to fetch the last 30 days from IBKR.",
      };
    }
    // 30-day Flex window: anything >25d without a success risks losing trades
    // that have aged out of the saved query window.
    if (days >= 25) {
      return {
        kind: "error" as const,
        text: `Trade sync stale (last success ${days}d ago) — risk of missing data older than the Flex 30-day window.`,
      };
    }
    return null;
  }, [sync, lastResult, syncing]);

  const sign = (v: number) => (v > 0 ? "+" : "");
  const colorClass = (v: number) => {
    if (v > 0) return styles.gain;
    if (v < 0) return styles.loss;
    return styles.neutral;
  };

  const syncButtonLabel = (() => {
    if (syncing) return "Syncing…";
    if (cooldownRemaining > 0) return `Wait ${formatMs(cooldownRemaining)}`;
    return "Sync";
  })();

  return (
    <div className={pageStyles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${pageStyles.modalCard} ${styles.modalCardCalendar}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className={pageStyles.modalHeader}>
          <div className={pageStyles.modalTitle + " font-display"}>
            PnL Calendar 收益日历
          </div>
          <button type="button" className={pageStyles.modalClose} onClick={onClose}>×</button>
        </div>

        {banner && (
          <div
            className={`${styles.syncBanner} ${
              banner.kind === "error" ? styles.syncBannerError : styles.syncBannerWarn
            }`}
          >
            <span>{banner.text}</span>
          </div>
        )}

        <div className={styles.controls}>
          <div className={styles.controlsLeft}>
            <select
              className={styles.monthSelect}
              value={`${year}-${month}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-").map(Number);
                setYear(y);
                setMonth(m);
              }}
            >
              {monthOptions.slice(0, 24).map((opt) => (
                <option key={`${opt.year}-${opt.month}`} value={`${opt.year}-${opt.month}`}>
                  {opt.year} / {opt.month.toString().padStart(2, "0")}
                </option>
              ))}
            </select>
            <select
              className={styles.monthSelect}
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value as AssetClassFilter)}
            >
              <option value="all">All</option>
              <option value="OPT">Options</option>
              <option value="STK">Stocks</option>
            </select>
            <select
              className={styles.monthSelect}
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value as DisplayCurrency)}
              title="Display currency"
            >
              <option value="USD">USD</option>
              <option value="SGD">SGD</option>
            </select>
            <button
              type="button"
              className={styles.syncBtn}
              onClick={() => runSync()}
              disabled={syncDisabled}
              title={
                cooldownRemaining > 0
                  ? "IBKR per-query cooldown — try again when the timer expires"
                  : "Pull trades from IBKR Flex Query"
              }
            >
              {syncButtonLabel}
            </button>
          </div>
          <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
            Last sync: {formatRelative(sync?.lastSuccessAt ?? null)}
          </span>
        </div>

        <div className={styles.summaryBox}>
          <div>
            <div className={styles.summaryLabel}>
              {new Date(year, month - 1).toLocaleString('default', { month: 'short' })} Realized P&L
            </div>
            <div className={`${styles.summaryValue} ${colorClass(totalPnl)} tabular-nums`}>
              {loading ? "..." : `${sign(totalPnl)}${totalPnl.toFixed(2)}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={styles.summaryLabel}>Currency</div>
            <div className={`${styles.summaryValue} ${styles.neutral} tabular-nums`} style={{ fontSize: 18 }}>
              {displayCurrency}
            </div>
          </div>
        </div>

        <div className={styles.gridHeader}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <div key={`header-${i}`} className={styles.weekday}>{day}</div>
          ))}
        </div>

        <div className={styles.grid}>
          {cells.map((cell, i) => {
            if (cell.type === "empty") {
              return <div key={`empty-${i}`} className={styles.emptyCell} />;
            }
            const displayPnl = toDisplay(cell.day!);
            const hasData = displayPnl !== 0;
            return (
              <div key={`day-${cell.day}`} className={styles.cell}>
                <div className={`${styles.dayNumber} tabular-nums`}>{cell.day}</div>
                {hasData ? (
                  <div className={`${styles.dayPnl} ${colorClass(displayPnl)} tabular-nums`}>
                    {sign(displayPnl)}{Math.abs(displayPnl).toFixed(2)}
                  </div>
                ) : (
                  <div className={`${styles.dayPnl} ${styles.neutral} tabular-nums`}>
                    +0.00
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
