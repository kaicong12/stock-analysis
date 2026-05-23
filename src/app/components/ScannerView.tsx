"use client";

import { useCallback, useMemo, useState } from "react";
import styles from "../page.module.css";

interface ScannerRow {
  symbol: string;
  name: string;
  conid: number;
}

export function ScannerView({
  onSendToBatch,
}: {
  onSendToBatch: (tickers: string[]) => void;
}) {
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: 50 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setRows((json.rows as ScannerRow[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback((symbol: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(rows.map((r) => r.symbol)));
  }, [rows]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const send = useCallback(() => {
    if (selected.size === 0) return;
    // Preserve scanner row order (IBKR's native ranking).
    const ordered = rows.map((r) => r.symbol).filter((s) => selected.has(s));
    onSendToBatch(ordered);
  }, [rows, selected, onSendToBatch]);

  const allSelected = useMemo(
    () => rows.length > 0 && selected.size === rows.length,
    [rows, selected],
  );

  return (
    <div className={styles.scannerWrap}>
      <header className={styles.batchHeader}>
        <h1 className="font-display">Scanner</h1>
        <p>
          Large-cap US majors with elevated IV vs. history. Filters baked from your trading
          profile: price &gt; $20, daily volume &gt; 500k, option volume &gt; 1k, market cap &ge; $10B.
          Sorted by IBKR&apos;s native IV-over-history ranking.
        </p>
      </header>

      <section className={styles.scannerControls}>
        <button className={styles.btnPrimary} onClick={run} disabled={loading}>
          {loading ? "Scanning…" : "Scan"}
        </button>
        {rows.length > 0 && (
          <>
            <button className={styles.btnGhost} onClick={allSelected ? clearSelection : selectAll}>
              {allSelected ? "Clear" : "Select all"}
            </button>
            <span className={styles.scannerCount}>
              {selected.size} / {rows.length} selected
            </span>
            <button
              className={styles.btnPrimary}
              onClick={send}
              disabled={selected.size === 0}
            >
              Send to Batch Analyze →
            </button>
          </>
        )}
      </section>

      {error && (
        <div className={styles.errorBanner}>
          <strong>Scan failed</strong>
          <span>{error}</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className={styles.scannerTableWrap}>
          <table className={styles.scannerTable}>
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Symbol</th>
                <th>Name</th>
                <th style={{ width: 80, textAlign: "right" }}>Rank</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.conid}
                  className={selected.has(r.symbol) ? styles.scannerRowSelected : undefined}
                  onClick={() => toggle(r.symbol)}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.symbol)}
                      onChange={() => toggle(r.symbol)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className={styles.scannerSymbol}>{r.symbol}</td>
                  <td className={styles.scannerName}>{r.name}</td>
                  <td style={{ textAlign: "right" }}>#{i + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className={styles.scannerEmpty}>
          Click <strong>Scan</strong> to fetch candidates from IBKR.
        </div>
      )}
    </div>
  );
}
