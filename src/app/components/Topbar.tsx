"use client";

import type { FormEvent } from "react";
import styles from "../page.module.css";
import { IconSearch, IconSparkle } from "./icons";

export type AuthStatus = {
  ok: boolean;
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
} | null;

export type TabKey = "single" | "scanner" | "batch";

const TABS: { key: TabKey; label: string }[] = [
  { key: "single", label: "Single" },
  { key: "scanner", label: "Scanner" },
  { key: "batch", label: "Batch Analyze" },
];

export function Topbar({
  ticker,
  setTicker,
  onSubmit,
  loading,
  activeTab,
  onTabChange,
  onOpenAskAi,
  askAiAvailable,
}: {
  ticker: string;
  setTicker: (s: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
  authStatus: AuthStatus;
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
  onOpenAskAi: () => void;
  askAiAvailable: boolean;
}) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarLeft}>
        <div className={styles.brandWord}>ALPHA INSIGHTS</div>
        <nav className={styles.tabStrip}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.tabButton} ${activeTab === t.key ? styles.tabButtonActive : ""}`}
              onClick={() => onTabChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {activeTab === "single" ? (
        <form onSubmit={onSubmit}>
          <div className={styles.searchWrap}>
            <IconSearch />
            <input
              className={styles.searchInput}
              placeholder="Search ticker (e.g. GOOGL, AAPL, HK.00700)"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            {loading && <span className="label-caps">Analyzing…</span>}
          </div>
        </form>
      ) : (
        <span />
      )}
      {/* Button is only visible below 1280px (CSS-controlled); on desktop the
          inline Ask AI panel makes it redundant. */}
      <button
        type="button"
        className={styles.topbarAskAi}
        onClick={onOpenAskAi}
        disabled={!askAiAvailable}
        aria-label="Open Ask AI"
      >
        <IconSparkle />
        Ask AI
      </button>
    </header>
  );
}
