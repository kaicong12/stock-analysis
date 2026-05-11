"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";

interface GlossaryEntry {
  symbol: string;
  name: string;
  blurb: string;
  detail: string;
}

const ENTRIES: GlossaryEntry[] = [
  {
    symbol: "Δ",
    name: "Delta",
    blurb: "Sensitivity to a $1 move in the underlying.",
    detail: "Long calls: 0 → +1.0. Long puts: 0 → −1.0. Often read loosely as the option's probability of finishing in the money. ATM ≈ 0.50, deep ITM ≈ 1.0, deep OTM ≈ 0.05.",
  },
  {
    symbol: "Γ",
    name: "Gamma",
    blurb: "Rate of change of delta.",
    detail: "How fast delta moves when the underlying moves. Highest at-the-money and near expiry. High gamma = whippy P/L on small underlying moves; usually a sign you're trading short-dated ATM options.",
  },
  {
    symbol: "Θ",
    name: "Theta",
    blurb: "Time decay per calendar day.",
    detail: "Negative for long options (you bleed time value daily); positive for short options (you collect it). Accelerates in the last 30 days. Always quoted in $ per contract per day.",
  },
  {
    symbol: "ν",
    name: "Vega",
    blurb: "Sensitivity to a 1% change in implied volatility.",
    detail: "Long options are positive vega (gain when IV rises); short options are negative vega. Long-dated and ATM options have the most vega. If you're selling premium when IV is high, you want vega to drop (mean-revert).",
  },
  {
    symbol: "ρ",
    name: "Rho",
    blurb: "Sensitivity to interest-rate changes.",
    detail: "Usually small enough to ignore for short-dated equity options. Matters for LEAPS and during rate-shift regimes. Calls have positive rho; puts have negative rho.",
  },
  {
    symbol: "IV",
    name: "Implied Volatility",
    blurb: "Annualised expected vol baked into the option price.",
    detail: "What the market is pricing in for future moves. High IV = expensive options, favorable for sellers; low IV = cheap, favorable for buyers. Compare current IV to the underlying's IV percentile / IV rank to judge regime.",
  },
  {
    symbol: "OI",
    name: "Open Interest",
    blurb: "Total open contracts on that strike.",
    detail: "A liquidity proxy. OI < 50 = thin; bid/ask spreads will be wide and your limit may not fill. OI > 1,000 = liquid for retail size.",
  },
  {
    symbol: "DTE",
    name: "Days to Expiry",
    blurb: "Calendar days until the option expires.",
    detail: "Drives theta and gamma. Sweet spot for most retail spreads / income trades is 30–45 DTE — long enough for the thesis to play, short enough that theta works for sellers and is bearable for buyers.",
  },
  {
    symbol: "ATM / ITM / OTM",
    name: "Moneyness",
    blurb: "Where the strike sits relative to spot.",
    detail: "ATM = strike near current price (highest gamma + theta + vega). ITM call = strike below spot; ITM put = strike above spot (high delta, behaves like the stock). OTM call = strike above spot; OTM put = strike below spot (cheap, lower probability).",
  },
];

export function GreeksGlossaryButton() {
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
        className={styles.glossaryBtn}
        onClick={() => setOpen(true)}
        aria-label="Open options glossary"
      >
        <span className={styles.glossaryBtnIcon}>?</span>
        <span className={styles.glossaryBtnLabel}>Options Glossary</span>
        <span className={styles.glossaryBtnHint}>Δ Γ Θ ν · IV · DTE</span>
      </button>
      {open && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className={`${styles.modalCard} scrollbar-slim`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Options glossary"
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle + " font-display"}>Options Glossary</div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setOpen(false)}
                aria-label="Close glossary"
              >
                ×
              </button>
            </div>
            <div className={styles.modalSubtitle}>
              Reference for the greeks &amp; option metrics. Press <kbd className={styles.welcomeKbd}>Esc</kbd> to close.
            </div>
            <div className={styles.glossaryList}>
              {ENTRIES.map((e) => (
                <div key={e.name} className={styles.glossaryItem}>
                  <div className={styles.glossarySym + " font-display"}>{e.symbol}</div>
                  <div className={styles.glossaryBody}>
                    <div className={styles.glossaryName}>{e.name}</div>
                    <div className={styles.glossaryBlurb}>{e.blurb}</div>
                    <div className={styles.glossaryDetail}>{e.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
