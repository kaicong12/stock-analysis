"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../page.module.css";
import checklistStyles from "./Checklist.module.css";

type ChecklistKey = "bull_put" | "bear_call";

interface ChecklistItem {
  id: string;
  text: string;
}

interface ChecklistDef {
  key: ChecklistKey;
  emoji: string;
  title: string;
  blurb: string;
  tone: "bullish" | "bearish";
  items: ChecklistItem[];
}

const CHECKLISTS: ChecklistDef[] = [
  {
    key: "bull_put",
    emoji: "🟢",
    title: "Bull Put Credit Spread",
    blurb: "Used when you are neutral to bullish on a stock.",
    tone: "bullish",
    items: [
      {
        id: "ivr",
        text: "IV Rank ≥ 30 (required), ≥ 50 preferred. Below 30 the premium is too cheap for the risk — almost always a skip. 30-50 is the marginal-IV band: tradeable when directional conviction is strong (see directional override below). ≥ 50 is the lean-in tier where credit selling has the cleanest math.",
      },
      {
        id: "ivhv",
        text: "IV / HV ratio ≥ 1.2× (required), ≥ 1.5× preferred. ≥ 1.2× confirms the options market is paying more than realized movement. ≥ 1.5× is the lean-in tier where the implied-vs-realized gap is wide enough that IV mean-reversion alone gives you positive expected value, before any directional move.",
      },
      {
        id: "directional_override",
        text: "Directional override: if BOTH conviction ≥ 75 AND there's a real technical support level your short strike sits below, you may take the trade with marginal IV (IVR 30-50 + IV/HV 1.2-1.5×). The trade thesis is then 'price stays above support' rather than 'IV mean-reverts.' Skip if the override conditions are not met AND IV is marginal.",
      },
      {
        id: "support",
        text: "Identify Support Levels: Look for a price floor where the stock has historically bounced. Your Short Put (the one you sell) should ideally be placed below this level.",
      },
      {
        id: "delta",
        text: "Check the Delta: Look for a Short Put Delta between 0.15 and 0.30. This suggests a 70% to 85% statistical probability of the option expiring worthless. Default 0.15-0.20; only step tighter (0.20-0.30) when conviction is high and the strike sits at or above a real technical support.",
      },
      {
        id: "width",
        text: "Spread Width: Choose your Long Put (the one you buy) based on the underlying spot — 5-wide for stocks $50-200, 10-wide for $200-500, 20-wide for $500+. A wider spread collects more premium but carries a higher Max Loss.",
      },
      {
        id: "rr",
        text: "Risk/Reward Ratio: Aim to collect a credit that is at least 20% to 33% of the spread width. For a $5 wide spread, you'd want at least $1.00 to $1.65 in credit. Target ROC 20–30% on the candidates table.",
      },
      {
        id: "nav",
        text: "NAV Sizing: Cap total max loss at ≤ 1.5% of NAV. Per-contract max loss = (width × 100) − net credit. Scale contracts down before stepping to a tighter delta.",
      },
      {
        id: "dte",
        text: "Days to Expiration (DTE): Target 30–45 days. This is where Theta decay accelerates in your favor.",
      },
      {
        id: "earnings",
        text: "Earnings Buffer: Confirm the expiry closes ≥ 2 days BEFORE the next earnings print. Never hold a credit position through earnings — IV crush risk is asymmetric against you.",
      },
      {
        id: "exit",
        text: "Profit Take: Plan a 50%-of-max close target at order entry. Gamma + IV-expansion risk dominate the second half of theta payoff; recycle freed capital into a fresh 30-45 DTE trade.",
      },
    ],
  },
  {
    key: "bear_call",
    emoji: "🔴",
    title: "Bear Call Credit Spread",
    blurb: "Used when you are neutral to bearish on a stock.",
    tone: "bearish",
    items: [
      {
        id: "ivr",
        text: "IV Rank ≥ 30 (required), ≥ 50 preferred. Below 30 the premium is too cheap for the risk — almost always a skip. 30-50 is the marginal-IV band: tradeable when directional conviction is strong (see directional override below). ≥ 50 is the lean-in tier where credit selling has the cleanest math.",
      },
      {
        id: "ivhv",
        text: "IV / HV ratio ≥ 1.2× (required), ≥ 1.5× preferred. ≥ 1.2× confirms the options market is paying more than realized movement. ≥ 1.5× is the lean-in tier where the implied-vs-realized gap is wide enough that IV mean-reversion alone gives you positive expected value, before any directional move.",
      },
      {
        id: "directional_override",
        text: "Directional override: if BOTH conviction ≥ 75 AND there's a real technical resistance level your short strike sits above, you may take the trade with marginal IV (IVR 30-50 + IV/HV 1.2-1.5×). The trade thesis is then 'price stays below resistance' rather than 'IV mean-reverts.' Skip if the override conditions are not met AND IV is marginal.",
      },
      {
        id: "resistance",
        text: "Identify Resistance Levels: Look for a price ceiling the stock struggles to break through. Your Short Call should be placed above this level.",
      },
      {
        id: "delta",
        text: "Check the Delta: Target a Short Call Delta between 0.15 and 0.30. Default 0.15-0.20; only step tighter (0.20-0.30) when conviction is high and the strike sits at or below a real technical resistance.",
      },
      {
        id: "dividends",
        text: "Check for Dividends: If the stock has an upcoming ex-dividend date, ensure the extrinsic value of your Short Call is greater than the dividend to avoid early assignment risk.",
      },
      {
        id: "technical",
        text: "Technical Confirmation: Check if the stock is overbought (RSI > 70, MACD turning). It's safer to sell calls when momentum is slowing.",
      },
      {
        id: "gap",
        text: "The Gap Rule: Ensure your Short Call is far enough away that a standard daily move (1× ATR) wouldn't easily pierce your strike.",
      },
      {
        id: "credit",
        text: "Credit vs. Width: Aim for a credit that represents roughly 1/3 of the spread width. Target ROC 20–30%.",
      },
      {
        id: "nav",
        text: "NAV Sizing: Cap total max loss at ≤ 1.5% of NAV. Per-contract max loss = (width × 100) − net credit.",
      },
      {
        id: "dte",
        text: "Days to Expiration (DTE): Target 30–45 days for accelerating theta decay.",
      },
      {
        id: "earnings",
        text: "Earnings Buffer: Confirm the expiry closes ≥ 2 days BEFORE the next earnings print. Never hold a credit position through earnings.",
      },
      {
        id: "exit",
        text: "Profit Take: Plan a 50%-of-max close target at order entry.",
      },
    ],
  },
];

const STORAGE_KEY = "alpha-term:checklist-state:v1";

type CheckedState = Record<ChecklistKey, Record<string, boolean>>;

function loadState(): CheckedState {
  if (typeof window === "undefined") {
    return { bull_put: {}, bear_call: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { bull_put: {}, bear_call: {} };
    const parsed = JSON.parse(raw) as Partial<CheckedState>;
    return {
      bull_put: parsed.bull_put ?? {},
      bear_call: parsed.bear_call ?? {},
    };
  } catch {
    return { bull_put: {}, bear_call: {} };
  }
}

export function ChecklistButton() {
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
        aria-label="Open credit spread checklist"
      >
        <span className={styles.railActionBtnIcon}>✓</span>
        <span className={styles.railActionBtnLabel}>Spread Checklist</span>
        <span className={styles.railActionBtnHint}>Pre-trade review</span>
      </button>
      {open && <ChecklistModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ChecklistModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<CheckedState>(() => loadState());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* localStorage may throw in private mode / quota — ignore */
    }
  }, [state]);

  function toggle(key: ChecklistKey, id: string) {
    setState((prev) => ({
      ...prev,
      [key]: { ...prev[key], [id]: !prev[key][id] },
    }));
  }

  function reset(key: ChecklistKey) {
    setState((prev) => ({ ...prev, [key]: {} }));
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${styles.modalCard} ${checklistStyles.modal} scrollbar-slim`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Credit spread checklist"
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle + " font-display"}>Credit Spread Checklist</div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close checklist">
            ×
          </button>
        </div>
        <div className={styles.modalSubtitle}>
          Run these checks before opening a credit spread. Ticks persist between sessions — reset when starting a new trade.
        </div>

        <div className={checklistStyles.grid}>
          {CHECKLISTS.map((c) => (
            <ChecklistCard
              key={c.key}
              def={c}
              checked={state[c.key]}
              onToggle={(id) => toggle(c.key, id)}
              onReset={() => reset(c.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChecklistCard({
  def,
  checked,
  onToggle,
  onReset,
}: {
  def: ChecklistDef;
  checked: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const completed = useMemo(
    () => def.items.filter((i) => checked[i.id]).length,
    [def.items, checked],
  );
  const total = def.items.length;
  const allDone = completed === total;

  return (
    <section
      className={`${checklistStyles.card} ${def.tone === "bullish" ? checklistStyles.bullish : checklistStyles.bearish}`}
    >
      <header className={checklistStyles.cardHeader}>
        <div className={checklistStyles.cardTitleRow}>
          <span className={checklistStyles.cardEmoji}>{def.emoji}</span>
          <span className={`${checklistStyles.cardTitle} font-display`}>{def.title}</span>
          <span
            className={`${checklistStyles.progress} tabular-nums ${allDone ? checklistStyles.progressDone : ""}`}
          >
            {completed}/{total}
          </span>
        </div>
        <p className={checklistStyles.cardBlurb}>{def.blurb}</p>
      </header>

      <ul className={checklistStyles.items}>
        {def.items.map((item) => {
          const isChecked = !!checked[item.id];
          return (
            <li key={item.id}>
              <label
                className={`${checklistStyles.item} ${isChecked ? checklistStyles.itemChecked : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(item.id)}
                  className={checklistStyles.checkbox}
                />
                <span className={checklistStyles.itemText}>{item.text}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className={checklistStyles.cardFooter}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={onReset}
          disabled={completed === 0}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
