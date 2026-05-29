"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../page.module.css";
import type {
  ContractPick,
  JournalCloseLeg,
  Verdict,
} from "../../lib/types";
import type { JournalLegInput, JournalStrategy } from "../../lib/journal/types";

// ---- Public types & entry points -------------------------------------------
//
// The modal used to place orders via IBKR. That capability is gone — the user
// places trades in IBKR/TWS directly (more trustworthy quotes) and uses this
// modal only to log the trade in the journal after the fact.

export type OrderModalIntent =
  | { kind: "open-pick"; pick: ContractPick; verdict: Verdict; ticker: string; symbol: string }
  | { kind: "roll"; pick: ContractPick; verdict: Verdict; ticker: string; symbol: string }
  | {
      kind: "close-held";
      legs: JournalCloseLeg[];
      ticker: string;
      symbol: string;
      strategy: JournalStrategy | string;
      expiry: string;
      journalTradeId?: number | null;
      // Best-guess net price (signed: + = paid debit to close, − = received credit to close).
      // Used as the form default; user overrides with their actual fill.
      defaultLimitPrice: number;
      defaultQuantity: number;
      // Optional original net credit (positive = received on open) for PnL math.
      originalNetCredit?: number | null;
    };

export function OrderModal({
  intent,
  onClose,
}: {
  intent: OrderModalIntent;
  onClose: () => void;
}) {
  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title =
    intent.kind === "close-held"
      ? "Log Close to Journal"
      : intent.kind === "roll"
        ? "Log Roll to Journal"
        : "Log Trade to Journal";

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalTitle + " font-display"}>
              {title}
              <span style={{ marginLeft: 10, fontSize: 13, color: "var(--on-surface-variant)" }}>
                {intent.ticker}
              </span>
            </div>
            <div className={styles.modalSubtitle}>
              Place the order in IBKR / TWS, then record it here.
            </div>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {intent.kind === "close-held" ? (
          <JournalCloseForm intent={intent} onClose={onClose} />
        ) : (
          <JournalOpenForm
            pick={intent.pick}
            verdict={intent.verdict}
            ticker={intent.ticker}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ---- Open / Roll: log a new trade -----------------------------------------

function strategyFromPick(p: ContractPick | undefined, fallback: JournalStrategy = "CUSTOM"): JournalStrategy {
  if (!p) return fallback;
  switch (p.strategy) {
    case "BUY_CALL_SPREAD":
    case "BUY_PUT_SPREAD":
    case "SELL_PUT_SPREAD":
    case "SELL_CALL_SPREAD":
    case "SELL_COVERED_CALL":
    case "SELL_CASH_SECURED_PUT":
    case "IRON_CONDOR":
      return p.strategy;
    default:
      return fallback;
  }
}

function legsForJournal(pick: ContractPick): JournalLegInput[] {
  const out: JournalLegInput[] = [];
  const push = (action: "BUY" | "SELL", leg: { side: "C" | "P"; strike: number; delta: number | null } | undefined) => {
    if (!leg) return;
    out.push({
      side: leg.side,
      action,
      strike: leg.strike,
      deltaAtEntry: leg.delta,
      conid: null,
    });
  };
  if (pick.rollPlan) {
    for (const l of pick.rollPlan.openingLegs) {
      const r = (l.ratio ?? 1) >= 0 ? 1 : -1;
      push(r === 1 ? "BUY" : "SELL", { side: l.side, strike: l.strike, delta: l.delta });
    }
    return out;
  }
  if (pick.longLeg) push("BUY", pick.longLeg);
  if (pick.shortLeg) push("SELL", pick.shortLeg);
  if (pick.longPutLeg) push("BUY", pick.longPutLeg);
  if (pick.shortPutLeg) push("SELL", pick.shortPutLeg);
  if (pick.shortCallLeg) push("SELL", pick.shortCallLeg);
  if (pick.longCallLeg) push("BUY", pick.longCallLeg);
  return out;
}

function deriveThesis(verdict: Verdict): string {
  return `${verdict.rationale} (confidence ${verdict.confidence}).`;
}

function deriveMgmtProfit(pick: ContractPick, netCredit: number): string {
  if (netCredit > 0) {
    const target = (netCredit * 0.5).toFixed(2);
    return `Close at 50% of credit ($${target}/contract) or technical invalidator.`;
  }
  return `Scale out at +50% of debit or once underlying clears breakeven $${pick.breakeven.toFixed(2)} cleanly.`;
}

function deriveMgmtLoss(pick: ContractPick, verdict: Verdict, netCredit: number): string {
  if (netCredit > 0) {
    const stop = (Math.abs(netCredit) * 2).toFixed(2);
    return `Close at 2× credit ($${stop}/contract). Hard invalidator: ${verdict.riskFactor}`;
  }
  return `Stop at −50% of debit or invalidator: ${verdict.riskFactor}`;
}

function pickExpiry(p: ContractPick): string {
  return (
    p.longLeg?.expiry ??
    p.shortLeg?.expiry ??
    p.shortPutLeg?.expiry ??
    p.rollPlan?.openingLegs?.[0]?.expiry ??
    new Date().toISOString().slice(0, 10)
  );
}

function JournalOpenForm({
  pick,
  verdict,
  ticker,
  onClose,
}: {
  pick: ContractPick;
  verdict: Verdict;
  ticker: string;
  onClose: () => void;
}) {
  const today = new Date();
  const expiryIso = pickExpiry(pick);
  const expiryDate = new Date(expiryIso);
  const dte = Math.max(0, Math.round((expiryDate.getTime() - today.getTime()) / 86_400_000));

  // Initial net credit from the picker (its limitPrice is signed: + = debit, − = credit).
  // The journal convention is positive = received.
  const suggestedNetCredit = -(pick.rollPlan ? -pick.rollPlan.netRollCredit : pick.limitPrice);

  const [strategy, setStrategy] = useState<JournalStrategy>(() => strategyFromPick(pick));
  const [netCredit, setNetCredit] = useState<string>(suggestedNetCredit.toFixed(2));
  const [quantity, setQuantity] = useState<number>(Math.max(1, pick.suggestedContracts));
  const [maxRisk, setMaxRisk] = useState<string>(
    Math.max(0.01, pick.maxLoss / Math.max(1, pick.suggestedContracts) / 100).toFixed(2),
  );
  const [thesis, setThesis] = useState<string>(deriveThesis(verdict));
  const [mgmtProfit, setMgmtProfit] = useState<string>(deriveMgmtProfit(pick, suggestedNetCredit));
  const [mgmtLoss, setMgmtLoss] = useState<string>(deriveMgmtLoss(pick, verdict, suggestedNetCredit));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const legs = useMemo(() => legsForJournal(pick), [pick]);

  async function save() {
    setErr(null);
    const nc = Number(netCredit);
    const mr = Number(maxRisk);
    if (!Number.isFinite(nc)) return setErr("netCredit must be a number");
    if (!Number.isFinite(mr) || mr <= 0) return setErr("maxRisk must be > 0");
    if (!thesis.trim() || !mgmtProfit.trim() || !mgmtLoss.trim()) {
      return setErr("thesis and management plans are required");
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          strategy,
          expiry: expiryIso,
          dteAtEntry: dte,
          netCredit: nc,
          maxRisk: mr,
          contracts: quantity,
          thesis: thesis.trim(),
          mgmtProfit: mgmtProfit.trim(),
          mgmtLoss: mgmtLoss.trim(),
          ibkrOpenOrderId: null,
          legs,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (saved) {
    return (
      <div className={styles.journalForm}>
        <div className={styles.journalTradeBody}>Journal entry saved.</div>
        <div className={styles.journalActions}>
          <button type="button" className={styles.btnPrimary} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.journalForm}>
      <label className={styles.journalField}>Strategy
        <select className={styles.journalSelect} value={strategy} onChange={(e) => setStrategy(e.target.value as JournalStrategy)}>
          <option value="SELL_PUT_SPREAD">Bull Put Spread</option>
          <option value="SELL_CALL_SPREAD">Bear Call Spread</option>
          <option value="IRON_CONDOR">Iron Condor</option>
          <option value="SELL_CASH_SECURED_PUT">CSP</option>
          <option value="SELL_COVERED_CALL">Covered Call</option>
          <option value="BUY_CALL_SPREAD">Bull Call Spread</option>
          <option value="BUY_PUT_SPREAD">Bear Put Spread</option>
          <option value="LONG_CALL">Long Call</option>
          <option value="LONG_PUT">Long Put</option>
          <option value="CUSTOM">Custom</option>
        </select>
      </label>
      <label className={styles.journalField}>Contracts
        <input
          className={`${styles.journalInput} tabular-nums`}
          type="number"
          min={1}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        />
      </label>
      <label className={styles.journalField}>Net credit ($/spread, +=received)
        <input className={`${styles.journalInput} tabular-nums`} type="number" step="0.01" value={netCredit} onChange={(e) => setNetCredit(e.target.value)} />
      </label>
      <label className={styles.journalField}>Max risk ($/spread)
        <input className={`${styles.journalInput} tabular-nums`} type="number" step="0.01" value={maxRisk} onChange={(e) => setMaxRisk(e.target.value)} />
      </label>
      <label className={styles.journalField}>Expiry
        <input className={styles.journalInput} type="date" value={expiryIso} disabled readOnly />
      </label>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Trade thesis
        <textarea className={styles.journalTextarea} value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2} />
      </label>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Management plan: profit
        <textarea className={styles.journalTextarea} value={mgmtProfit} onChange={(e) => setMgmtProfit(e.target.value)} rows={2} />
      </label>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Management plan: loss
        <textarea className={styles.journalTextarea} value={mgmtLoss} onChange={(e) => setMgmtLoss(e.target.value)} rows={2} />
      </label>
      {err && <div className={styles.journalError}>Error: {err}</div>}
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={onClose} disabled={submitting}>Cancel</button>
        <button type="button" className={styles.btnPrimary} onClick={save} disabled={submitting}>
          {submitting ? "Saving…" : "Save journal entry"}
        </button>
      </div>
    </div>
  );
}

// ---- Close-held: log an exit ----------------------------------------------

function JournalCloseForm({
  intent,
  onClose,
}: {
  intent: Extract<OrderModalIntent, { kind: "close-held" }>;
  onClose: () => void;
}) {
  // Default fill price (per contract, signed: + = paid to close, − = received to close).
  const [fillPrice, setFillPrice] = useState<string>(intent.defaultLimitPrice.toFixed(2));
  const [exitReason, setExitReason] = useState<string>("Closed in IBKR.");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const qty = intent.defaultQuantity;
  const fp = Number(fillPrice);
  const pnl =
    intent.originalNetCredit != null && Number.isFinite(fp)
      ? (intent.originalNetCredit - fp) * qty * 100
      : Number.isFinite(fp)
        ? -fp * qty * 100
        : 0;

  async function save() {
    setErr(null);
    if (!Number.isFinite(fp)) return setErr("fill price must be a number");
    if (!intent.journalTradeId) {
      setSaved(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/journal/${intent.journalTradeId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          realizedPnl: pnl,
          exitReason: exitReason.trim() || "Closed in IBKR.",
          ibkrCloseOrderId: null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (saved) {
    return (
      <div className={styles.journalForm}>
        <div className={styles.journalTradeBody}>
          {intent.journalTradeId
            ? `Journal entry closed. Realized P/L $${pnl.toFixed(2)}.`
            : "No journal entry linked — nothing recorded."}
        </div>
        <div className={styles.journalActions}>
          <button type="button" className={styles.btnPrimary} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.journalForm}>
      <div className={styles.journalLegs}>
        <div className={styles.journalLegsLabel}>Closing legs</div>
        {intent.legs.map((l, i) => (
          <div key={i} className={styles.journalLegRow}>
            <span style={{ fontWeight: 600 }}>{l.ratio === 1 ? "BUY" : "SELL"}</span>
            <span>{l.side === "C" ? "CALL" : "PUT"}</span>
            <span className="tabular-nums">{l.strike}</span>
            <span style={{ color: "var(--on-surface-variant)" }}>{l.expiry}</span>
          </div>
        ))}
      </div>

      <label className={styles.journalField}>Quantity (contracts)
        <input className={`${styles.journalInput} tabular-nums`} type="number" min={1} value={qty} disabled readOnly />
      </label>

      <label className={styles.journalField}>Fill price (+ = paid, − = received)
        <input
          className={`${styles.journalInput} tabular-nums`}
          type="number"
          step="0.01"
          value={fillPrice}
          onChange={(e) => setFillPrice(e.target.value)}
        />
      </label>

      <div className={styles.journalSpan} style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 12px",
        background: "var(--surface-container-low)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--outline-variant)",
        marginTop: 4,
      }}>
        <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--on-surface-variant)" }}>
          Realized P/L
        </span>
        <span className="tabular-nums" style={{ fontSize: 18, fontWeight: 600, color: pnl >= 0 ? "var(--bullish)" : "var(--bearish)" }}>
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
        </span>
      </div>

      <label className={`${styles.journalField} ${styles.journalSpan}`}>Exit reason
        <textarea className={styles.journalTextarea} value={exitReason} onChange={(e) => setExitReason(e.target.value)} rows={2} />
      </label>

      {!intent.journalTradeId && (
        <div className={styles.journalSpan} style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
          No open journal entry was found for this position. The close will be acknowledged but not recorded.
        </div>
      )}

      {err && <div className={styles.journalError}>Error: {err}</div>}
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={onClose} disabled={submitting}>Cancel</button>
        <button type="button" className={styles.btnPrimary} onClick={save} disabled={submitting}>
          {submitting ? "Saving…" : intent.journalTradeId ? "Save close" : "Done"}
        </button>
      </div>
    </div>
  );
}
