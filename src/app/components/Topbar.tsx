"use client";

import type { FormEvent } from "react";
import styles from "../page.module.css";
import { IconSearch } from "./icons";

export function Topbar({
  ticker,
  setTicker,
  onSubmit,
  loading,
}: {
  ticker: string;
  setTicker: (s: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarLeft}>
        <div className={styles.brandWord}>ALPHA INSIGHTS</div>
      </div>
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
    </header>
  );
}
