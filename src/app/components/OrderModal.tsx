"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../page.module.css";
import type {
  ContractPick,
  OrderIntent,
  OrderLeg,
  OrderPlaceResponse,
  OrderStatus,
  Verdict,
} from "../../lib/types";
import type { JournalLegInput, JournalStrategy } from "../../lib/journal/types";

// ---- Public types & entry points -------------------------------------------

export type OrderModalIntent =
  | { kind: "open-pick"; pick: ContractPick; verdict: Verdict; ticker: string; symbol: string }
  | { kind: "roll"; pick: ContractPick; verdict: Verdict; ticker: string; symbol: string }
  | {
      kind: "close-held";
      legs: OrderLeg[];
      ticker: string;
      symbol: string;
      strategy: JournalStrategy | string;
      expiry: string;
      // Open journal trade id if we recognise this close; absent → close-only,
      // no journal mutation. quantity defaults to |contracts in legs|.
      journalTradeId?: number | null;
      // Best-guess net price (signed: + = pay debit, − = receive credit).
      defaultLimitPrice: number;
      defaultQuantity: number;
      // Optional original net credit (positive = received on open) for PnL math.
      originalNetCredit?: number | null;
    };

export function OrderModal(props: {
  intent: OrderModalIntent;
  onClose: () => void;
  onPlaced?: (resp: OrderPlaceResponse) => void;
}) {
  return <OrderModalInner {...props} />;
}

// ---- Internal -------------------------------------------------------------

type Stage =
  | { kind: "review" }
  | { kind: "submitting" }
  | { kind: "submitted-open"; resp: OrderPlaceResponse }
  | { kind: "journal-prefill"; resp: OrderPlaceResponse }
  | { kind: "submitted-close"; resp: OrderPlaceResponse; pollStatus: OrderStatus | null; pollAttempt: number }
  | { kind: "journal-closing"; pnl: number; ibkrCloseOrderId: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

function pickInitialLimit(intent: OrderModalIntent): number {
  if (intent.kind === "open-pick" || intent.kind === "roll") {
    // ContractPick.limitPrice is the picker's net (signed by convention:
    // positive = debit, negative = credit). For a roll, prefer the
    // openingCredit-net-of-closingCost from the rollPlan if present.
    if (intent.kind === "roll" && intent.pick.rollPlan) {
      // netRollCredit is positive when we receive. Convert to debit-positive.
      return -intent.pick.rollPlan.netRollCredit;
    }
    return intent.pick.limitPrice;
  }
  return intent.defaultLimitPrice;
}

function pickInitialQty(intent: OrderModalIntent): number {
  if (intent.kind === "open-pick" || intent.kind === "roll") {
    return Math.max(1, intent.pick.suggestedContracts);
  }
  return Math.max(1, intent.defaultQuantity);
}

function fmtMoney(x: number): string {
  const s = Math.abs(x) >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2);
  return (x < 0 ? "−$" : "$") + s.replace(/^-/, "");
}

function netLabel(price: number, qty: number): { label: string; tone: "bullish" | "bearish" | "neutral" } {
  // Signed dollar amount for the package: price × qty × 100 (option multiplier).
  // Positive = debit to pay, negative = credit to receive.
  const dollars = price * qty * 100;
  if (price < 0) return { label: `Credit ${fmtMoney(Math.abs(dollars))}`, tone: "bullish" };
  if (price > 0) return { label: `Debit ${fmtMoney(dollars)}`, tone: "bearish" };
  return { label: "$0", tone: "neutral" };
}

// Convert an OrderModalIntent into the on-the-wire OrderIntent the API expects.
function toApiIntent(intent: OrderModalIntent): OrderIntent {
  if (intent.kind === "open-pick") return { kind: "open-pick", pick: intent.pick };
  if (intent.kind === "roll") return { kind: "roll", pick: intent.pick };
  return {
    kind: "close-held",
    legs: intent.legs,
    strategy: String(intent.strategy),
    ticker: intent.ticker,
    expiry: intent.expiry,
  };
}

function legsForReview(intent: OrderModalIntent): { action: "BUY" | "SELL"; side: "C" | "P"; strike: number; expiry: string }[] {
  if (intent.kind === "open-pick" || intent.kind === "roll") {
    const out: { action: "BUY" | "SELL"; side: "C" | "P"; strike: number; expiry: string }[] = [];
    const p = intent.pick;
    const push = (action: "BUY" | "SELL", side: "C" | "P" | undefined, strike: number | undefined, expiry: string | undefined) => {
      if (side && strike != null && expiry) out.push({ action, side, strike, expiry });
    };
    if (intent.kind === "roll" && p.rollPlan) {
      for (const l of p.rollPlan.closingLegs) {
        const heldRatio = (l.ratio ?? 1) >= 0 ? 1 : -1;
        push(heldRatio === 1 ? "SELL" : "BUY", l.side, l.strike, l.expiry);
      }
      for (const l of p.rollPlan.openingLegs) {
        const r = (l.ratio ?? 1) >= 0 ? 1 : -1;
        push(r === 1 ? "BUY" : "SELL", l.side, l.strike, l.expiry);
      }
      return out;
    }
    if (p.longLeg) push("BUY", p.longLeg.side, p.longLeg.strike, p.longLeg.expiry);
    if (p.shortLeg) push("SELL", p.shortLeg.side, p.shortLeg.strike, p.shortLeg.expiry);
    if (p.longPutLeg) push("BUY", p.longPutLeg.side, p.longPutLeg.strike, p.longPutLeg.expiry);
    if (p.shortPutLeg) push("SELL", p.shortPutLeg.side, p.shortPutLeg.strike, p.shortPutLeg.expiry);
    if (p.shortCallLeg) push("SELL", p.shortCallLeg.side, p.shortCallLeg.strike, p.shortCallLeg.expiry);
    if (p.longCallLeg) push("BUY", p.longCallLeg.side, p.longCallLeg.strike, p.longCallLeg.expiry);
    return out;
  }
  return intent.legs.map((l) => ({
    action: l.ratio === 1 ? "BUY" : "SELL",
    side: l.side,
    strike: l.strike,
    expiry: l.expiry,
  }));
}

function OrderModalInner({
  intent,
  onClose,
  onPlaced,
}: {
  intent: OrderModalIntent;
  onClose: () => void;
  onPlaced?: (resp: OrderPlaceResponse) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "review" });
  const [limitPrice, setLimitPrice] = useState<number>(() => pickInitialLimit(intent));
  const [quantity, setQuantity] = useState<number>(() => pickInitialQty(intent));
  const [tif, setTif] = useState<"DAY" | "GTC">("DAY");
  const [outsideRTH, setOutsideRTH] = useState<boolean>(false);

  // Esc to close — but only when we're not mid-submit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && stage.kind !== "submitting") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage.kind, onClose]);

  const legs = useMemo(() => legsForReview(intent), [intent]);
  const net = netLabel(limitPrice, quantity);

  async function submit() {
    setStage({ kind: "submitting" });
    try {
      const res = await fetch("/api/orders/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: toApiIntent(intent),
          symbol: intent.symbol,
          limitPrice,
          quantity,
          tif,
          outsideRTH,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as OrderPlaceResponse & { error?: string };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onPlaced?.(j);
      if (intent.kind === "close-held") {
        setStage({ kind: "submitted-close", resp: j, pollStatus: null, pollAttempt: 0 });
      } else {
        setStage({ kind: "submitted-open", resp: j });
      }
    } catch (e) {
      setStage({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={stage.kind === "submitting" ? undefined : onClose} role="presentation">
      <div
        className={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Place order"
      >
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalTitle + " font-display"}>
              {intent.kind === "close-held" ? "Close Position" : intent.kind === "roll" ? "Roll Order" : "Place Order"}
              <span style={{ marginLeft: 10, fontSize: 13, color: "var(--on-surface-variant)" }}>{intent.ticker}</span>
            </div>
            <div className={styles.modalSubtitle}>
              {stage.kind === "review" && "Review legs, set price, then confirm."}
              {stage.kind === "submitting" && "Submitting to IBKR…"}
              {stage.kind === "submitted-open" && "Order accepted. Save journal entry next."}
              {stage.kind === "journal-prefill" && "Phase A · Journal entry (prefilled)."}
              {stage.kind === "submitted-close" && "Order accepted. Waiting for fill to record P/L."}
              {stage.kind === "journal-closing" && "Recording exit to journal…"}
              {stage.kind === "done" && "Done."}
              {stage.kind === "error" && "Something went wrong."}
            </div>
          </div>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close"
            disabled={stage.kind === "submitting"}
          >
            ×
          </button>
        </div>

        {stage.kind === "review" && (
          <ReviewStage
            legs={legs}
            limitPrice={limitPrice}
            setLimitPrice={setLimitPrice}
            quantity={quantity}
            setQuantity={setQuantity}
            tif={tif}
            setTif={setTif}
            outsideRTH={outsideRTH}
            setOutsideRTH={setOutsideRTH}
            netLabel={net}
            onCancel={onClose}
            onSubmit={submit}
          />
        )}

        {stage.kind === "submitting" && (
          <div className={styles.modalSubtitle}>Sending…</div>
        )}

        {stage.kind === "submitted-open" && (
          <SubmittedOpenStage
            resp={stage.resp}
            onContinue={() => setStage({ kind: "journal-prefill", resp: stage.resp })}
            onSkip={() => setStage({ kind: "done", message: "Order placed. Journal entry skipped." })}
          />
        )}

        {stage.kind === "journal-prefill" && intent.kind !== "close-held" && (
          <JournalPrefillStage
            pick={intent.pick}
            verdict={intent.verdict}
            ticker={intent.ticker}
            limitPrice={limitPrice}
            quantity={quantity}
            ibkrOpenOrderId={stage.resp.orderId}
            onSaved={() => setStage({ kind: "done", message: "Order placed and journal entry saved." })}
            onSkip={() => setStage({ kind: "done", message: "Order placed. Journal entry skipped." })}
          />
        )}

        {stage.kind === "submitted-close" && (
          <CloseFillPoller
            intent={intent as Extract<OrderModalIntent, { kind: "close-held" }>}
            resp={stage.resp}
            limitPrice={limitPrice}
            quantity={quantity}
            onComputed={(pnl, ibkrCloseOrderId) =>
              setStage({ kind: "journal-closing", pnl, ibkrCloseOrderId })
            }
            onAbandon={(msg) => setStage({ kind: "done", message: msg })}
          />
        )}

        {stage.kind === "journal-closing" && (
          <JournalCloseStage
            intent={intent as Extract<OrderModalIntent, { kind: "close-held" }>}
            pnl={stage.pnl}
            ibkrCloseOrderId={stage.ibkrCloseOrderId}
            onDone={(msg) => setStage({ kind: "done", message: msg })}
          />
        )}

        {stage.kind === "done" && (
          <DoneStage message={stage.message} onClose={onClose} />
        )}

        {stage.kind === "error" && (
          <ErrorStage
            message={stage.message}
            onRetry={() => setStage({ kind: "review" })}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ---- Stages ----------------------------------------------------------------

function ReviewStage(props: {
  legs: { action: "BUY" | "SELL"; side: "C" | "P"; strike: number; expiry: string }[];
  limitPrice: number;
  setLimitPrice: (n: number) => void;
  quantity: number;
  setQuantity: (n: number) => void;
  tif: "DAY" | "GTC";
  setTif: (t: "DAY" | "GTC") => void;
  outsideRTH: boolean;
  setOutsideRTH: (b: boolean) => void;
  netLabel: { label: string; tone: "bullish" | "bearish" | "neutral" };
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const toneColor =
    props.netLabel.tone === "bullish" ? "var(--bullish)" : props.netLabel.tone === "bearish" ? "var(--bearish)" : "var(--on-surface-variant)";
  return (
    <div className={styles.journalForm}>
      <div className={styles.journalLegs}>
        <div className={styles.journalLegsLabel}>Legs</div>
        {props.legs.map((l, i) => (
          <div key={i} className={styles.journalLegRow}>
            <span style={{ fontWeight: 600 }}>{l.action}</span>
            <span>{l.side === "C" ? "CALL" : "PUT"}</span>
            <span className="tabular-nums">{l.strike}</span>
            <span style={{ color: "var(--on-surface-variant)" }}>{l.expiry}</span>
          </div>
        ))}
      </div>

      <label className={styles.journalField}>
        Limit price (signed, + = debit, − = credit)
        <input
          className={`${styles.journalInput} tabular-nums`}
          type="number"
          step="0.01"
          value={Number.isFinite(props.limitPrice) ? props.limitPrice : 0}
          onChange={(e) => props.setLimitPrice(Number(e.target.value))}
        />
      </label>

      <label className={styles.journalField}>
        Quantity (contracts)
        <input
          className={`${styles.journalInput} tabular-nums`}
          type="number"
          min={1}
          step={1}
          value={props.quantity}
          onChange={(e) => props.setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        />
      </label>

      <label className={styles.journalField}>
        Time in force
        <select className={styles.journalSelect} value={props.tif} onChange={(e) => props.setTif(e.target.value as "DAY" | "GTC")}>
          <option value="DAY">DAY</option>
          <option value="GTC">GTC</option>
        </select>
      </label>

      <label className={styles.journalField}>
        Outside RTH
        <select className={styles.journalSelect} value={props.outsideRTH ? "1" : "0"} onChange={(e) => props.setOutsideRTH(e.target.value === "1")}>
          <option value="0">No (RTH only)</option>
          <option value="1">Yes</option>
        </select>
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
          Net (qty × $ × 100)
        </span>
        <span className="tabular-nums" style={{ fontSize: 18, fontWeight: 600, color: toneColor }}>
          {props.netLabel.label}
        </span>
      </div>

      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={props.onCancel}>Cancel</button>
        <button type="button" className={styles.btnPrimary} onClick={props.onSubmit}>Submit to IBKR</button>
      </div>
    </div>
  );
}

function SubmittedOpenStage({
  resp,
  onContinue,
  onSkip,
}: {
  resp: OrderPlaceResponse;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div className={styles.journalForm}>
      <div className={styles.journalTradeBody}>
        IBKR accepted the order.
      </div>
      <div className={`${styles.journalTradeSub} tabular-nums`}>
        Order ID: <strong>{resp.orderId}</strong> · Status: {resp.status}
      </div>
      {resp.warnings.length > 0 && (
        <div className={styles.journalTradeSub}>
          Auto-confirmed warnings: {resp.warnings.slice(0, 3).join(" · ")}
          {resp.warnings.length > 3 ? " …" : ""}
        </div>
      )}
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={onSkip}>Skip journal</button>
        <button type="button" className={styles.btnPrimary} onClick={onContinue}>Continue to journal</button>
      </div>
    </div>
  );
}

// ---- Journal prefill -------------------------------------------------------

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
  const push = (action: "BUY" | "SELL", leg: { side: "C" | "P"; strike: number; delta: number | null; conid?: number } | undefined) => {
    if (!leg) return;
    out.push({
      side: leg.side,
      action,
      strike: leg.strike,
      deltaAtEntry: leg.delta,
      conid: leg.conid ?? null,
    });
  };
  if (pick.rollPlan) {
    // For a roll-open journal entry, only the opening legs matter.
    for (const l of pick.rollPlan.openingLegs) {
      const r = (l.ratio ?? 1) >= 0 ? 1 : -1;
      push(r === 1 ? "BUY" : "SELL", { side: l.side, strike: l.strike, delta: l.delta, conid: l.conid });
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

function deriveMgmtProfit(pick: ContractPick, limitPrice: number): string {
  const credit = -limitPrice; // positive number when credit
  if (credit > 0) {
    const target = (credit * 0.5).toFixed(2);
    return `Close at 50% of credit ($${target}/contract) or technical invalidator.`;
  }
  // Debit/long structure — target on BE move.
  const be = pick.breakeven;
  return `Scale out at +50% of debit or once underlying clears breakeven $${be.toFixed(2)} cleanly.`;
}

function deriveMgmtLoss(pick: ContractPick, verdict: Verdict, limitPrice: number): string {
  const credit = -limitPrice;
  if (credit > 0) {
    const stop = (Math.abs(credit) * 2).toFixed(2);
    return `Close at 2× credit ($${stop}/contract). Hard invalidator: ${verdict.riskFactor}`;
  }
  return `Stop at −50% of debit or invalidator: ${verdict.riskFactor}`;
}

function JournalPrefillStage({
  pick,
  verdict,
  ticker,
  limitPrice,
  quantity,
  ibkrOpenOrderId,
  onSaved,
  onSkip,
}: {
  pick: ContractPick;
  verdict: Verdict;
  ticker: string;
  limitPrice: number;
  quantity: number;
  ibkrOpenOrderId: string;
  onSaved: () => void;
  onSkip: () => void;
}) {
  const today = new Date();
  const expiryDate = new Date(pick.longLeg?.expiry ?? pick.shortLeg?.expiry ?? pick.shortPutLeg?.expiry ?? pick.rollPlan?.openingLegs?.[0]?.expiry ?? today.toISOString().slice(0, 10));
  const dte = Math.max(0, Math.round((expiryDate.getTime() - today.getTime()) / 86_400_000));
  const expiryIso = expiryDate.toISOString().slice(0, 10);

  // netCredit field convention in the journal: positive = received. Our signed
  // limitPrice has + = debit, so flip the sign for credit-style strategies.
  const initialNetCredit = -limitPrice;

  const [strategy, setStrategy] = useState<JournalStrategy>(() => strategyFromPick(pick));
  const [netCredit, setNetCredit] = useState<string>(initialNetCredit.toFixed(2));
  const [maxRisk, setMaxRisk] = useState<string>(Math.max(0.01, pick.maxLoss / Math.max(1, quantity) / 100).toFixed(2));
  const [thesis, setThesis] = useState<string>(deriveThesis(verdict));
  const [mgmtProfit, setMgmtProfit] = useState<string>(deriveMgmtProfit(pick, limitPrice));
  const [mgmtLoss, setMgmtLoss] = useState<string>(deriveMgmtLoss(pick, verdict, limitPrice));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const legs = useMemo(() => legsForJournal(pick), [pick]);

  async function save() {
    setErr(null);
    const nc = Number(netCredit);
    const mr = Number(maxRisk);
    if (!Number.isFinite(nc)) return setErr("netCredit must be a number");
    if (!Number.isFinite(mr) || mr <= 0) return setErr("maxRisk must be > 0");
    if (!thesis.trim() || !mgmtProfit.trim() || !mgmtLoss.trim()) return setErr("thesis and management plans are required");
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
          ivRank: null,
          netCredit: nc,
          maxRisk: mr,
          contracts: quantity,
          thesis: thesis.trim(),
          mgmtProfit: mgmtProfit.trim(),
          mgmtLoss: mgmtLoss.trim(),
          ibkrOpenOrderId,
          legs,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.journalForm}>
      <div className={styles.journalSpan} style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
        Linked IBKR order: <strong>{ibkrOpenOrderId}</strong>
      </div>
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
        <button type="button" className={styles.btnGhost} onClick={onSkip} disabled={submitting}>Skip</button>
        <button type="button" className={styles.btnPrimary} onClick={save} disabled={submitting}>
          {submitting ? "Saving…" : "Save journal entry"}
        </button>
      </div>
    </div>
  );
}

// ---- Close-held poller -----------------------------------------------------

// We poll /api/orders/status every 5s for up to 5 minutes. On Filled we compute
// realized PnL from avgFillPrice. If the user closed something they didn't
// journal (no journalTradeId), we still surface the fill but skip the journal
// mutation.
function CloseFillPoller({
  intent,
  resp,
  limitPrice,
  quantity,
  onComputed,
  onAbandon,
}: {
  intent: Extract<OrderModalIntent, { kind: "close-held" }>;
  resp: OrderPlaceResponse;
  limitPrice: number;
  quantity: number;
  onComputed: (pnl: number, ibkrCloseOrderId: string) => void;
  onAbandon: (message: string) => void;
}) {
  const [pollAttempt, setPollAttempt] = useState(0);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function tick(attempt: number) {
      if (cancelled || stoppedRef.current) return;
      setPollAttempt(attempt);
      try {
        const r = await fetch(`/api/orders/status?orderId=${encodeURIComponent(resp.orderId)}`);
        if (!cancelled && r.ok) {
          const s = (await r.json()) as OrderStatus;
          setStatus(s);
          if (/fill/i.test(s.status) || s.status === "Filled") {
            // Compute PnL: closing trade. If originalNetCredit is known
            // (positive = received on open), PnL per contract = (originalNetCredit − closingCost).
            // closingCost = avgFillPrice if we paid to close, or -avgFillPrice if we received.
            // For simplicity: our signed close limitPrice was + = debit-to-pay, − = credit-received.
            // Same convention applies to the fill price.
            const fillPx = s.avgFillPrice ?? limitPrice;
            // Default: assume close costs `fillPx` per contract. Net PnL per contract:
            //   PnL = (openCreditPerCt − fillPx) × 100 (credit strategy)
            //   PnL = (fillPx − openDebitPerCt) × 100 (debit strategy)
            // We use originalNetCredit if available; otherwise we report fillPx × qty × 100
            // signed by limitPrice convention as a best-effort.
            let pnl: number;
            if (intent.originalNetCredit !== null && intent.originalNetCredit !== undefined) {
              pnl = (intent.originalNetCredit - fillPx) * quantity * 100;
            } else {
              pnl = -fillPx * quantity * 100;
            }
            stoppedRef.current = true;
            if (intent.journalTradeId) {
              onComputed(pnl, s.orderId);
            } else {
              onAbandon(`Closed (fill $${fillPx.toFixed(2)}). No journal entry linked — skipped journal update.`);
            }
            return;
          }
          if (/cancel|reject/i.test(s.status)) {
            stoppedRef.current = true;
            onAbandon(`Order ended without fill (status: ${s.status}). No journal update.`);
            return;
          }
        }
      } catch {
        // ignore transient poll errors; the next tick retries.
      }
      if (attempt >= 60) {
        stoppedRef.current = true;
        onAbandon("Fill not seen after 5 minutes. Close the modal — journal can be updated manually later.");
        return;
      }
      setTimeout(() => { void tick(attempt + 1); }, 5_000);
    }
    void tick(1);
    return () => { cancelled = true; };
  }, [resp.orderId, limitPrice, quantity, intent, onAbandon, onComputed]);

  return (
    <div className={styles.journalForm}>
      <div className={styles.journalTradeBody}>
        IBKR accepted the close. Polling for fill…
      </div>
      <div className={`${styles.journalTradeSub} tabular-nums`}>
        Order ID: <strong>{resp.orderId}</strong> · Status: {status?.status ?? "Submitted"} · poll {pollAttempt}/60
      </div>
      {status?.avgFillPrice != null && (
        <div className={`${styles.journalTradeSub} tabular-nums`}>
          Avg fill: ${status.avgFillPrice.toFixed(2)} · filled {status.filledQuantity}/{status.totalQuantity}
        </div>
      )}
      <div className={styles.journalActions}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => {
            stoppedRef.current = true;
            onAbandon("Stopped polling. You can update the journal manually once the order fills in IBKR.");
          }}
        >
          Stop polling
        </button>
      </div>
    </div>
  );
}

function JournalCloseStage({
  intent,
  pnl,
  ibkrCloseOrderId,
  onDone,
}: {
  intent: Extract<OrderModalIntent, { kind: "close-held" }>;
  pnl: number;
  ibkrCloseOrderId: string;
  onDone: (msg: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exitReason, setExitReason] = useState<string>(
    `Closed via app at fill (order ${ibkrCloseOrderId}).`,
  );

  async function save() {
    if (!intent.journalTradeId) {
      onDone("No journal entry linked.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/journal/${intent.journalTradeId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          realizedPnl: pnl,
          exitReason: exitReason.trim() || "Closed via app.",
          ibkrCloseOrderId,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onDone(`Journal entry closed. Realized P/L $${pnl.toFixed(2)}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.journalForm}>
      <div className={styles.journalTradeBody}>
        Fill detected. Recording exit to journal #{intent.journalTradeId}.
      </div>
      <div className={`${styles.journalTradeSub} tabular-nums`}>
        Computed P/L: <strong style={{ color: pnl >= 0 ? "var(--bullish)" : "var(--bearish)" }}>
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
        </strong>
      </div>
      <label className={`${styles.journalField} ${styles.journalSpan}`}>Exit reason
        <textarea className={styles.journalTextarea} value={exitReason} onChange={(e) => setExitReason(e.target.value)} rows={2} />
      </label>
      {err && <div className={styles.journalError}>Error: {err}</div>}
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={() => onDone("Skipped journal close.")} disabled={submitting}>Skip</button>
        <button type="button" className={styles.btnPrimary} onClick={save} disabled={submitting}>
          {submitting ? "Saving…" : "Save journal close"}
        </button>
      </div>
    </div>
  );
}

function DoneStage({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className={styles.journalForm}>
      <div className={styles.journalTradeBody}>{message}</div>
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnPrimary} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ErrorStage({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className={styles.journalForm}>
      <div className={styles.journalError}>Order failed: {message}</div>
      <div className={styles.journalActions}>
        <button type="button" className={styles.btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={styles.btnPrimary} onClick={onRetry}>Back to review</button>
      </div>
    </div>
  );
}
