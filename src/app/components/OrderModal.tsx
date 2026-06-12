"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";
import type { JournalCloseLeg } from "../../lib/types";
import type { JournalStrategy } from "../../lib/journal/types";

// ---- Public types & entry points -------------------------------------------
//
// The modal used to place orders via IBKR. That capability is gone — the user
// places trades in IBKR/TWS directly (more trustworthy quotes) and uses this
// modal only to log the trade in the journal after the fact.

export type OrderModalIntent =
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

  const title = "Log Close to Journal";

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

        <JournalCloseForm intent={intent} onClose={onClose} />
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
