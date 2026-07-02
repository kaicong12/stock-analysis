"use client";

import type { FormEvent } from "react";
import styles from "../page.module.css";
import { IconSearch } from "./icons";

export type AuthStatus = {
  ok: boolean;
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
} | null;

export type TabKey = "single" | "scanner";

const TABS: { key: TabKey; label: string }[] = [
  { key: "single", label: "Single" },
  { key: "scanner", label: "Scanner" },
];

export function Topbar({
  ticker,
  setTicker,
  onSubmit,
  loading,
  activeTab,
  onTabChange,
}: {
  ticker: string;
  setTicker: (s: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
  authStatus: AuthStatus;
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
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
    </header>
  );
}
