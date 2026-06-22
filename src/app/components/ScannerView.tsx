"use client";

import { useCallback, useMemo, useState } from "react";
import styles from "../page.module.css";
import type { ScanType } from "../../lib/ibkr/scanner";

interface ScannerRow {
  symbol: string;
  name: string;
  conid: number;
}

const MIN_PRICE_FLOOR = 20;
const MIN_OPT_VOLUME_FLOOR = 500;
const SIZE_FLOOR = 10;
const SIZE_CEIL = 100;
const IV_FLOOR = 0;
const IV_CEIL = 100;

function clamp(value: number, min: number, max: number = Infinity): number {
  return Math.max(min, Math.min(max, value));
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

  // Filter params — number inputs held as strings to avoid mid-typing snap desync
  const [scanType, setScanType] = useState<ScanType>("HIGH_OPT_IMP_VOLAT_OVER_HIST");
  const [minPrice, setMinPrice] = useState<string>("20");
  const [minOptVolume, setMinOptVolume] = useState<string>("1000");
  const [minIvPercentile, setMinIvPercentile] = useState<string>("50");
  const [minIvRank, setMinIvRank] = useState<string>("50");
  const [size, setSize] = useState<string>("50");

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    const parsedSize = clamp(Number(size) || 50, SIZE_FLOOR, SIZE_CEIL);
    const parsedMinPrice = clamp(Number(minPrice) || MIN_PRICE_FLOOR, MIN_PRICE_FLOOR);
    const parsedMinOptVolume = clamp(
      Number(minOptVolume) || 1000,
      MIN_OPT_VOLUME_FLOOR,
    );
    const parsedMinIvPercentile = clamp(Number(minIvPercentile) || 0, IV_FLOOR, IV_CEIL);
    const parsedMinIvRank = clamp(Number(minIvRank) || 0, IV_FLOOR, IV_CEIL);
    try {
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size: parsedSize,
          scanType,
          minPrice: parsedMinPrice,
          minOptVolume: parsedMinOptVolume,
          minIvPercentile: parsedMinIvPercentile,
          minIvRank: parsedMinIvRank,
        }),
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
  }, [size, scanType, minPrice, minOptVolume, minIvPercentile, minIvRank]);

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
          Large-cap US majors screened for options volatility candidates. Daily volume &gt; 500k
          and market cap &ge; $10B are fixed per trading profile. The IV gates default to 50 —
          IV Percentile is the primary filter, IV Rank a secondary magnitude floor; set either to
          0 to disable. Adjust the parameters below to refine candidates for credit spread entry.
        </p>
      </header>

      <section className={styles.scannerFilters}>
        <div className={styles.scannerFilterGroup}>
          <label htmlFor="scan-type">Scan Type</label>
          <select
            id="scan-type"
            className={styles.journalSelect}
            value={scanType}
            onChange={(e) => setScanType(e.target.value as ScanType)}
          >
            <option value="HIGH_OPT_IMP_VOLAT_OVER_HIST">IV &gt; History (IVR)</option>
            <option value="HIGH_OPT_IMP_VOLAT">High IV (Absolute)</option>
          </select>
        </div>
        <div className={styles.scannerFilterGroup}>
          <label htmlFor="min-price">Min Price ($)</label>
          <input
            id="min-price"
            type="number"
            className={styles.journalInput}
            min={MIN_PRICE_FLOOR}
            step={1}
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            onBlur={() =>
              setMinPrice(String(clamp(Number(minPrice) || MIN_PRICE_FLOOR, MIN_PRICE_FLOOR)))
            }
          />
        </div>
        <div className={styles.scannerFilterGroup}>
          <label htmlFor="min-opt-vol">Min Option Volume</label>
          <input
            id="min-opt-vol"
            type="number"
            className={styles.journalInput}
            min={MIN_OPT_VOLUME_FLOOR}
            step={100}
            value={minOptVolume}
            onChange={(e) => setMinOptVolume(e.target.value)}
            onBlur={() =>
              setMinOptVolume(
                String(clamp(Number(minOptVolume) || 1000, MIN_OPT_VOLUME_FLOOR)),
              )
            }
          />
        </div>
        <div className={styles.scannerFilterGroup}>
          <label htmlFor="min-iv-percentile">Min IV Percentile (%)</label>
          <input
            id="min-iv-percentile"
            type="number"
            className={styles.journalInput}
            min={IV_FLOOR}
            max={IV_CEIL}
            step={5}
            value={minIvPercentile}
            onChange={(e) => setMinIvPercentile(e.target.value)}
            onBlur={() =>
              setMinIvPercentile(String(clamp(Number(minIvPercentile) || 0, IV_FLOOR, IV_CEIL)))
            }
          />
          <span className={styles.scannerHint}>Primary gate · how often IV has been this high. 0 = off</span>
        </div>
        <div className={styles.scannerFilterGroup}>
          <label htmlFor="min-iv-rank">Min IV Rank (%)</label>
          <input
            id="min-iv-rank"
            type="number"
            className={styles.journalInput}
            min={IV_FLOOR}
            max={IV_CEIL}
            step={5}
            value={minIvRank}
            onChange={(e) => setMinIvRank(e.target.value)}
            onBlur={() =>
              setMinIvRank(String(clamp(Number(minIvRank) || 0, IV_FLOOR, IV_CEIL)))
            }
          />
          <span className={styles.scannerHint}>Secondary · IV vs its 52w high/low. 0 = off</span>
        </div>
        <div className={styles.scannerFilterGroup}>
          <label htmlFor="result-count">Result Count</label>
          <input
            id="result-count"
            type="number"
            className={styles.journalInput}
            min={SIZE_FLOOR}
            max={SIZE_CEIL}
            step={10}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onBlur={() =>
              setSize(String(clamp(Number(size) || 50, SIZE_FLOOR, SIZE_CEIL)))
            }
          />
        </div>
      </section>

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
