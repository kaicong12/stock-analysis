"use client";

import { useEffect, useState, useMemo } from "react";
import styles from "../page.module.css";
import type { JournalStrategy, JournalTradeWithLegs } from "../../lib/journal/types";

const STRATEGIES: JournalStrategy[] = [
  "SELL_PUT_SPREAD",
  "SELL_CALL_SPREAD",
  "IRON_CONDOR",
  "SELL_CASH_SECURED_PUT",
  "SELL_COVERED_CALL",
  "BUY_CALL_SPREAD",
  "BUY_PUT_SPREAD",
  "LONG_CALL",
  "LONG_PUT",
  "CUSTOM",
];

const STRATEGY_LABEL: Record<JournalStrategy, string> = {
  SELL_PUT_SPREAD: "Bull Put Spread",
  SELL_CALL_SPREAD: "Bear Call Spread",
  IRON_CONDOR: "Iron Condor",
  SELL_CASH_SECURED_PUT: "CSP",
  SELL_COVERED_CALL: "Covered Call",
  BUY_CALL_SPREAD: "Bull Call Spread (debit)",
  BUY_PUT_SPREAD: "Bear Put Spread (debit)",
  LONG_CALL: "Long Call",
  LONG_PUT: "Long Put",
  CUSTOM: "Custom",
};

type StatusFilter = "all" | "open" | "closed";

export function JournalButton() {
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
        className={styles.railActionBtn}
        onClick={() => setOpen(true)}
        aria-label="Open trade journal"
      >
        <span className={styles.railActionBtnIcon}>J</span>
        <span className={styles.railActionBtnLabel}>Trade Journal</span>
        <span className={styles.railActionBtnHint}>Phase A · Phase B</span>
      </button>
      {open && <JournalModal onClose={() => setOpen(false)} />}
    </>
  );
}

function JournalModal({ onClose }: { onClose: () => void }) {
  const [trades, setTrades] = useState<JournalTradeWithLegs[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tickerFilter, setTickerFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/journal?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { trades: JournalTradeWithLegs[] };
      setTrades(json.trades);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      await refresh();
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const tickerOptions = ["ALL", ...Array.from(new Set(trades.map((t) => t.ticker))).sort()];
  const visible = trades.filter((t) => tickerFilter === "ALL" || t.ticker === tickerFilter);

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${styles.modalCard} ${styles.journalModal} scrollbar-slim`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Trade journal"
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle + " font-display"}>Trade Journal</div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close journal">×</button>
        </div>
        <div className={styles.modalSubtitle}>
          Phase A: contract at entry. Phase B: review at exit.
        </div>

        <JournalToolbar
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          tickerFilter={tickerFilter}
          onTickerChange={setTickerFilter}
          tickerOptions={tickerOptions}
          onCreated={refresh}
        />

        {loading && <div className={styles.modalSubtitle}>Loading…</div>}
        {error && <div className={styles.modalSubtitle} style={{ color: "var(--bearish)" }}>Error: {error}</div>}

        <JournalList
          trades={visible}
          strategyLabel={STRATEGY_LABEL}
          onAfterMutation={refresh}
        />
      </div>
    </div>
  );
}

function JournalToolbar(props: {
  statusFilter: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  tickerFilter: string;
  onTickerChange: (t: string) => void;
  tickerOptions: string[];
  onCreated: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <div className={styles.journalToolbar}>
      <button
        type="button"
        className={styles.btnPrimary}
        onClick={() => setShowForm(true)}
      >
        + New trade
      </button>
      <label className={styles.journalField}>
        Status:
        <select className={styles.journalSelect}
          value={props.statusFilter}
          onChange={(e) => props.onStatusChange(e.target.value as StatusFilter)}
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </label>
      <label className={styles.journalField}>
        Ticker:
        <select className={styles.journalSelect}
          value={props.tickerFilter}
          onChange={(e) => props.onTickerChange(e.target.value)}
        >
          {props.tickerOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      {showForm && (
        <NewTradeForm
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            props.onCreated();
          }}
        />
      )}
    </div>
  );
}

function JournalList(props: {
  trades: JournalTradeWithLegs[];
  strategyLabel: Record<JournalStrategy, string>;
  onAfterMutation: () => void;
}) {
  if (props.trades.length === 0) {
    return <div className={styles.modalSubtitle}>No trades yet.</div>;
  }
  return (
    <div className={styles.journalList}>
      {props.trades.map((t) => (
        <TradeRow
          key={t.id}
          trade={t}
          label={props.strategyLabel[t.strategy] ?? t.strategy}
          onAfterMutation={props.onAfterMutation}
        />
      ))}
    </div>
  );
}

function TradeRow(props: {
  trade: JournalTradeWithLegs;
  label: string;
  onAfterMutation: () => void;
}) {
  const t = props.trade;
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const strikes = t.legs.map((l) => l.strike).sort((a, b) => a - b).join("/");
  const shortDeltas = t.legs
    .filter((l) => l.action === "SELL" && l.deltaAtEntry !== null)
    .map((l) => l.deltaAtEntry as number);
  const shortDeltaLabel = shortDeltas.length
    ? shortDeltas.map((d) => d.toFixed(2)).join(", ")
    : "—";
  const isOpen = t.status === "open";
  const showExit = t.status === "closed" || t.realizedPnl !== null || !!t.exitReason;
  return (
    <div
      className={styles.journalTradeCard}
    >
      <div className={styles.journalTradeHeader}>
        <div className={styles.journalTradeTitle}>
          {t.ticker} · {props.label}{strikes ? ` · ${strikes}` : ""}
        </div>
        <div className={styles.journalTradeMeta}>
          {isOpen ? "OPEN" : "CLOSED"} · {t.dteAtEntry} DTE
        </div>
      </div>
      <div className={styles.journalSectionLabel}>
        Phase A · Entry
      </div>
      <div className={`${styles.journalTradeMeta} tabular-nums`}>
        Credit ${t.netCredit.toFixed(2)} · Max risk ${t.maxRisk.toFixed(2)} · {t.contracts} ct
      </div>
      <div className={`${styles.journalTradeMeta} tabular-nums`}>
        Short Δ entry: {shortDeltaLabel}
      </div>
      <div className={styles.journalTradeBody}>Thesis: {t.thesis}</div>
      <div className={styles.journalTradeSub}>
        Management plan: profit — {t.mgmtProfit} · loss — {t.mgmtLoss}
      </div>
      {showExit && (
        <>
          <div className={styles.journalSectionLabel}>
            Phase B · Exit
          </div>
          <div className={`${styles.journalTradeMeta} tabular-nums`}>
            P/L {t.realizedPnl !== null ? `${t.realizedPnl >= 0 ? "+" : ""}${t.realizedPnl.toFixed(2)}` : "—"}
            {t.closedAt ? ` · closed ${new Date(t.closedAt).toLocaleDateString()}` : ""}
          </div>
          {t.exitReason && (
            <div className={styles.journalTradeBody}>Exit reason: {t.exitReason}</div>
          )}
        </>
      )}
      <div className={styles.journalActionRow}>
        <button type="button" className={styles.btnGhost} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide legs" : "Show legs"}
        </button>
        {isOpen && (
          <button type="button" className={styles.btnPrimary} onClick={() => setClosing(true)}>
            Close trade
          </button>
        )}
        <button
          type="button"
          className={`${styles.btnGhost} ${styles.btnDanger}`}
          onClick={async () => {
            if (!confirm(`Delete trade ${t.id} on ${t.ticker}?`)) return;
            const res = await fetch(`/api/journal/${t.id}`, { method: "DELETE" });
            if (res.ok) props.onAfterMutation();
            else alert(`Delete failed: HTTP ${res.status}`);
          }}
        >
          Delete
        </button>
      </div>
      {expanded && (
        <table className={`${styles.journalLegTable} tabular-nums`}>
          <thead>
            <tr>
              <th align="left">Action</th>
              <th align="left">Side</th>
              <th align="right">Strike</th>
              <th align="right">Δ entry</th>
            </tr>
          </thead>
          <tbody>
            {t.legs.map((l) => (
              <tr key={l.id}>
                <td>{l.action}</td>
                <td>{l.side}</td>
                <td align="right">{l.strike}</td>
                <td align="right">{l.deltaAtEntry !== null ? l.deltaAtEntry.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {closing && (
        <CloseTradeForm
          tradeId={t.id}
          onCancel={() => setClosing(false)}
          onClosed={() => {
            setClosing(false);
            props.onAfterMutation();
          }}
        />
      )}
    </div>
  );
}

function NewTradeForm(props: { onCancel: () => void; onCreated: () => void }) {
  function defaultLegsForStrategy(s: JournalStrategy) {
    if (s === "IRON_CONDOR") {
      return [
        { side: "P" as const, action: "BUY" as const, strike: "", deltaAtEntry: "" },
        { side: "P" as const, action: "SELL" as const, strike: "", deltaAtEntry: "" },
        { side: "C" as const, action: "SELL" as const, strike: "", deltaAtEntry: "" },
        { side: "C" as const, action: "BUY" as const, strike: "", deltaAtEntry: "" },
      ];
    }
    if (s === "SELL_PUT_SPREAD" || s === "BUY_PUT_SPREAD") {
      return [
        { side: "P" as const, action: "BUY" as const, strike: "", deltaAtEntry: "" },
        { side: "P" as const, action: "SELL" as const, strike: "", deltaAtEntry: "" },
      ];
    }
    if (s === "SELL_CALL_SPREAD" || s === "BUY_CALL_SPREAD") {
      return [
        { side: "C" as const, action: "SELL" as const, strike: "", deltaAtEntry: "" },
        { side: "C" as const, action: "BUY" as const, strike: "", deltaAtEntry: "" },
      ];
    }
    if (s === "SELL_CASH_SECURED_PUT" || s === "LONG_PUT") {
      return [
        { side: "P" as const, action: s === "SELL_CASH_SECURED_PUT" ? "SELL" as const : "BUY" as const, strike: "", deltaAtEntry: "" },
      ];
    }
    if (s === "SELL_COVERED_CALL" || s === "LONG_CALL") {
      return [
        { side: "C" as const, action: s === "SELL_COVERED_CALL" ? "SELL" as const : "BUY" as const, strike: "", deltaAtEntry: "" },
      ];
    }
    return [{ side: "C" as const, action: "BUY" as const, strike: "", deltaAtEntry: "" }];
  }

  const [ticker, setTicker] = useState("");
  const [strategy, setStrategy] = useState<JournalStrategy>("SELL_PUT_SPREAD");
  const [expiry, setExpiry] = useState("");
  const [netCredit, setNetCredit] = useState<string>("");
  const [maxRisk, setMaxRisk] = useState<string>("");
  const [contracts, setContracts] = useState<string>("1");
  const [thesis, setThesis] = useState("");
  const [mgmtProfit, setMgmtProfit] = useState("");
  const [mgmtLoss, setMgmtLoss] = useState("");
  const [legs, setLegs] = useState<{ side: "C" | "P"; action: "BUY" | "SELL"; strike: string; deltaAtEntry: string }[]>(
    defaultLegsForStrategy("SELL_PUT_SPREAD"),
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-calculation logic for Max Risk, Break-Even, ROC, and Net Delta using useMemo
  // to avoid cascading renders from setState inside useEffect.
  const calcs = useMemo(() => {
    const nc = parseFloat(netCredit);
    const strikes = legs.map(l => parseFloat(l.strike)).filter(s => !isNaN(s));
    
    // Net Delta: sum of (action === BUY ? 1 : -1) * delta
    let netD = 0;
    legs.forEach(l => {
      const d = parseFloat(l.deltaAtEntry);
      if (!isNaN(d)) {
        netD += (l.action === "BUY" ? 1 : -1) * d;
      }
    });
    const calcNetDelta = netD !== 0 ? netD.toFixed(2) : null;

    if (isNaN(nc)) {
      return { calcBE: null, calcROC: null, calcNetDelta, calculatedMaxRisk: null };
    }
    
    let calculatedMaxRisk: number | null = null;
    let calculatedBE: string | null = null;

    if (strategy === "SELL_PUT_SPREAD" && strikes.length === 2) {
      const sorted = [...strikes].sort((a, b) => a - b);
      const width = sorted[1] - sorted[0];
      calculatedMaxRisk = width - nc;
      calculatedBE = (sorted[1] - nc).toFixed(2);
    } else if (strategy === "SELL_CALL_SPREAD" && strikes.length === 2) {
      const sorted = [...strikes].sort((a, b) => a - b);
      const width = sorted[1] - sorted[0];
      calculatedMaxRisk = width - nc;
      calculatedBE = (sorted[0] + nc).toFixed(2);
    } else if (strategy === "IRON_CONDOR" && strikes.length === 4) {
      const sorted = [...strikes].sort((a, b) => a - b);
      const putWidth = sorted[1] - sorted[0];
      const callWidth = sorted[3] - sorted[2];
      calculatedMaxRisk = Math.max(putWidth, callWidth) - nc;
      calculatedBE = `${(sorted[1] - nc).toFixed(2)} / ${(sorted[2] + nc).toFixed(2)}`;
    } else if (strategy === "SELL_CASH_SECURED_PUT" && strikes.length === 1) {
      calculatedMaxRisk = strikes[0] - nc;
      calculatedBE = (strikes[0] - nc).toFixed(2);
    } else if (strategy === "BUY_CALL_SPREAD" && strikes.length === 2) {
      const sorted = [...strikes].sort((a, b) => a - b);
      calculatedMaxRisk = nc;
      calculatedBE = (sorted[0] + nc).toFixed(2);
    } else if (strategy === "BUY_PUT_SPREAD" && strikes.length === 2) {
      const sorted = [...strikes].sort((a, b) => a - b);
      calculatedMaxRisk = nc;
      calculatedBE = (sorted[1] - nc).toFixed(2);
    } else if (strategy === "LONG_CALL" && strikes.length === 1) {
      calculatedMaxRisk = nc;
      calculatedBE = (strikes[0] + nc).toFixed(2);
    } else if (strategy === "LONG_PUT" && strikes.length === 1) {
      calculatedMaxRisk = nc;
      calculatedBE = (strikes[0] - nc).toFixed(2);
    }

    let calcROC: string | null = null;
    if (calculatedMaxRisk !== null && calculatedMaxRisk > 0) {
      if (strategy.includes("SELL") || strategy === "IRON_CONDOR" || strategy === "SELL_CASH_SECURED_PUT" || strategy === "SELL_COVERED_CALL") {
        calcROC = ((nc / calculatedMaxRisk) * 100).toFixed(1) + "%";
      } else {
        let maxProfit: number | null = null;
        if ((strategy === "BUY_PUT_SPREAD" || strategy === "BUY_CALL_SPREAD") && strikes.length === 2) {
          const width = Math.abs(strikes[1] - strikes[0]);
          maxProfit = width - nc;
        } else if (strategy === "LONG_CALL" || strategy === "LONG_PUT") {
          maxProfit = Infinity;
        }

        if (maxProfit === Infinity) calcROC = "∞";
        else if (maxProfit !== null && maxProfit > 0) calcROC = ((maxProfit / nc) * 100).toFixed(1) + "%";
      }
    }

    return { calcBE: calculatedBE, calcROC, calcNetDelta, calculatedMaxRisk };
  }, [strategy, legs, netCredit]);

  function onStrategyChange(s: JournalStrategy) {
    setStrategy(s);
    setLegs(defaultLegsForStrategy(s));
  }

  const [nowMs] = useState(() => Date.now());
  
  function dteFromExpiry(iso: string): number {
    if (!iso) return 0;
    const target = Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10)),
    );
    return Math.round((target - nowMs) / 86_400_000);
  }

  async function submit() {
    setErr(null);
    if (!ticker.trim()) return setErr("ticker required");
    if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return setErr("expiry must be YYYY-MM-DD");
    const nc = Number(netCredit);
    const resolvedMaxRisk = maxRisk.trim() ? Number(maxRisk) : calcs.calculatedMaxRisk;
    const mr = resolvedMaxRisk;
    const ct = Number(contracts);
    if (!Number.isFinite(nc)) return setErr("netCredit must be a number");
    if (mr === null || !Number.isFinite(mr) || mr <= 0) return setErr("maxRisk is required and must be > 0");
    if (!Number.isInteger(ct) || ct <= 0) return setErr("contracts must be a positive integer");
    let legsParsed;
    try {
      legsParsed = legs.map((l) => {
        const strikeNum = Number(l.strike);
        if (!Number.isFinite(strikeNum) || strikeNum <= 0) throw new Error(`leg strike must be > 0`);
        const dEntry = l.deltaAtEntry.trim() ? Number(l.deltaAtEntry) : null;
        if (dEntry !== null && !Number.isFinite(dEntry)) throw new Error(`leg delta must be a number`);
        return { side: l.side, action: l.action, strike: strikeNum, deltaAtEntry: dEntry, conid: null };
      });
    } catch (e) {
      return setErr((e as Error).message);
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          strategy,
          expiry,
          dteAtEntry: dteFromExpiry(expiry),
          netCredit: nc,
          maxRisk: mr,
          contracts: ct,
          thesis: thesis.trim(),
          mgmtProfit: mgmtProfit.trim(),
          mgmtLoss: mgmtLoss.trim(),
          legs: legsParsed,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      props.onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const dtePreview = expiry ? dteFromExpiry(expiry) : null;

  return (
    <div
      className={styles.journalForm}
    >
      <div className={styles.journalSectionLabel}>
        Phase A · Entry
      </div>
      <label className={styles.journalField}>Ticker
        <input className={styles.journalInput} value={ticker} onChange={(e) => setTicker(e.target.value)} />
      </label>
      <label className={styles.journalField}>Strategy
        <select className={styles.journalSelect} value={strategy} onChange={(e) => onStrategyChange(e.target.value as JournalStrategy)}>
          {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}
        </select>
      </label>
      <label className={styles.journalField}>Expiry
        <input className={styles.journalInput} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </label>
      <label className={styles.journalField}>Contracts
        <input className={styles.journalInput} type="number" min={1} value={contracts} onChange={(e) => setContracts(e.target.value)} />
      </label>
      <label className={styles.journalField}>Net credit ($/spread)
        <input className={styles.journalInput} type="number" step="0.01" value={netCredit} onChange={(e) => setNetCredit(e.target.value)} />
      </label>
      <label className={styles.journalField}>Max risk ($/spread)
        <input 
          className={styles.journalInput} 
          type="number" 
          step="0.01" 
          value={maxRisk} 
          onChange={(e) => setMaxRisk(e.target.value)} 
          placeholder={calcs.calculatedMaxRisk ? calcs.calculatedMaxRisk.toFixed(2) : ""}
        />
      </label>

      <div className={styles.journalSpan} style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(4, 1fr)", 
        gap: 12, 
        padding: "10px 12px",
        background: "var(--surface-container-low)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--outline-variant)",
        marginTop: 4
      }}>
        <div className={styles.journalField}>
          <span className={styles.journalLegsLabel} style={{ fontSize: 10 }}>Entry DTE</span>
          <span className={styles.journalTradeTitle} style={{ fontSize: 16 }}>{dtePreview === null ? "—" : dtePreview}</span>
        </div>
        <div className={styles.journalField}>
          <span className={styles.journalLegsLabel} style={{ fontSize: 10 }}>Break-even</span>
          <span className={styles.journalTradeTitle} style={{ fontSize: 16 }}>{calcs.calcBE || "—"}</span>
        </div>
        <div className={styles.journalField}>
          <div className={styles.tooltipContainer}>
            <span className={styles.journalLegsLabel} style={{ fontSize: 10, borderBottom: "1px dotted var(--tertiary)" }}>ROC</span>
            <div className={styles.tooltipContent}>
              {strategy.includes("SELL") || strategy === "IRON_CONDOR" ? (
                "Credit Strategy: (Net Credit / Max Risk). Aim for 15-25% over 30-45 days."
              ) : (
                "Debit Strategy: (Max Profit / Net Debit). Higher potential but requires directional movement."
              )}
            </div>
          </div>
          <span className={styles.journalTradeTitle} style={{ fontSize: 16, color: calcs.calcROC ? "var(--tertiary)" : "inherit" }}>{calcs.calcROC || "—"}</span>
        </div>
        <div className={styles.journalField}>
          <div className={styles.tooltipContainer}>
            <span className={styles.journalLegsLabel} style={{ fontSize: 10, borderBottom: "1px dotted var(--tertiary)" }}>Net Delta</span>
            <div className={styles.tooltipContent}>
              {strategy.includes("SELL") || strategy === "IRON_CONDOR" ? (
                "For credit spreads: if Delta is high (> 0.30), you aren't being compensated enough for the risk."
              ) : (
                "For debit trades: Higher delta (0.50-0.60) is often preferred as it means more intrinsic value and faster gains on moves."
              )}
            </div>
          </div>
          <span className={styles.journalTradeTitle} style={{ fontSize: 16 }}>{calcs.calcNetDelta || "—"}</span>
        </div>
      </div>

      <div className={styles.journalLegs}>
        <div className={styles.journalLegsLabel}>Legs</div>
        {legs.map((l, i) => (
          <div key={i} className={styles.journalLegRow}>
            <select className={styles.journalSelect} value={l.action} onChange={(e) => setLegs((prev) => prev.map((x, j) => j === i ? { ...x, action: e.target.value as "BUY" | "SELL" } : x))}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <select className={styles.journalSelect} value={l.side} onChange={(e) => setLegs((prev) => prev.map((x, j) => j === i ? { ...x, side: e.target.value as "C" | "P" } : x))}>
              <option value="C">Call</option>
              <option value="P">Put</option>
            </select>
            <input className={styles.journalInput} type="number" step="0.01" placeholder="Strike" value={l.strike} onChange={(e) => setLegs((prev) => prev.map((x, j) => j === i ? { ...x, strike: e.target.value } : x))} />
            <input className={styles.journalInput} type="number" step="0.01" placeholder="Delta at entry" value={l.deltaAtEntry} onChange={(e) => setLegs((prev) => prev.map((x, j) => j === i ? { ...x, deltaAtEntry: e.target.value } : x))} />
          </div>
        ))}
      </div>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Trade thesis
        <textarea className={styles.journalTextarea} value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2} />
      </label>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Management plan: profit target
        <textarea className={styles.journalTextarea} value={mgmtProfit} onChange={(e) => setMgmtProfit(e.target.value)} rows={2} />
      </label>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Management plan: loss exit
        <textarea className={styles.journalTextarea} value={mgmtLoss} onChange={(e) => setMgmtLoss(e.target.value)} rows={2} />
      </label>
      {err && <div className={styles.journalError}>Error: {err}</div>}
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={props.onCancel}>Cancel</button>
        <button type="button" className={styles.btnPrimary} onClick={submit} disabled={submitting}>{submitting ? "Saving…" : "Save trade"}</button>
      </div>
    </div>
  );
}

function CloseTradeForm(props: { tradeId: number; onCancel: () => void; onClosed: () => void }) {
  const [realizedPnl, setRealizedPnl] = useState("");
  const [exitReason, setExitReason] = useState("");
  const [closedAtLocal, setClosedAtLocal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    const pnl = Number(realizedPnl);
    if (!Number.isFinite(pnl)) return setErr("P/L must be a number");
    if (!exitReason.trim()) return setErr("Exit reason is required");
    let closedAt: string | undefined;
    if (closedAtLocal.trim()) {
      const parsed = new Date(closedAtLocal);
      if (Number.isNaN(parsed.getTime())) return setErr("Closed at must be a valid date/time");
      closedAt = parsed.toISOString();
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/journal/${props.tradeId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realizedPnl: pnl, exitReason: exitReason.trim(), closedAt }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      props.onClosed();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={styles.journalForm}
    >
      <div className={styles.journalSectionLabel}>
        Phase B · Exit
      </div>
      <label className={styles.journalField}>Realized P/L ($)
        <input className={styles.journalInput} type="number" step="0.01" value={realizedPnl} onChange={(e) => setRealizedPnl(e.target.value)} />
      </label>
      <label className={styles.journalField}>Closed at (optional)
        <input className={styles.journalInput} type="datetime-local" value={closedAtLocal} onChange={(e) => setClosedAtLocal(e.target.value)} />
      </label>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Exit reason
        <textarea className={styles.journalTextarea} value={exitReason} onChange={(e) => setExitReason(e.target.value)} rows={2} />
      </label>
      {err && <div className={styles.journalError}>Error: {err}</div>}
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={props.onCancel}>Cancel</button>
        <button type="button" className={styles.btnPrimary} onClick={submit} disabled={submitting}>{submitting ? "Closing…" : "Close trade"}</button>
      </div>
    </div>
  );
}
