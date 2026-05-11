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

export function Topbar({ ticker, setTicker, onSubmit, loading }: {
  ticker: string;
  setTicker: (s: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
  authStatus: AuthStatus;
}) {
  return (
    <header className={styles.topbar}>
      <div className={styles.brandWord}>ALPHA INSIGHTS</div>
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
