"use client";

import styles from "../page.module.css";

export function Welcome() {
  return (
    <div className={styles.welcomeCard}>
      <h2 className="font-display">Synthesis-grade analysis, on demand.</h2>
      <p>
        Type a ticker and press <kbd className={styles.welcomeKbd}>↵</kbd>. We&rsquo;ll pull capital flow,
        technical indicators, options activity, news flow, and community sentiment from moomoo, cross-reference your IBKR portfolio,
        and have Gemini issue a portfolio-aware verdict.
      </p>
      <p style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
        Examples: <code>GOOGL</code>, <code>AAPL</code>, <code>HK.00700</code>, <code>NVDA</code>. Bare tickers default to US.
      </p>
    </div>
  );
}

export function SkeletonBlock() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={styles.skeleton} style={{ height: 200 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.skeleton} style={{ height: 220 }} />
        ))}
      </div>
    </div>
  );
}
