"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../page.module.css";
import {
  loadBatchSession,
  saveBatchResult,
  saveBatchSession,
  type BatchSessionRow,
} from "../../lib/batch/cache";
import {
  parseTickers,
  type BatchEvent,
  type BatchTickerPayload,
} from "../../lib/batch/protocol";
import type { Portfolio } from "../../lib/types";

type Stage = BatchSessionRow["stage"];

const STAGE_LABEL: Record<Stage, string> = {
  idle: "Queued",
  prep: "Fetching snapshot",
  panels: "Analyzing panels",
  verdict: "Synthesizing verdict",
  done: "Done",
  error: "Error",
};

function statusBucket(stage: Stage): "running" | "done" | "error" {
  if (stage === "done") return "done";
  if (stage === "error") return "error";
  return "running";
}

const STATUS_CLASS: Record<"running" | "done" | "error", string> = {
  running: styles.statusRunning,
  done: styles.statusDone,
  error: styles.statusError,
};

export function BatchView() {
  const [input, setInput] = useState<string>(() => loadBatchSession()?.input ?? "");
  const [rows, setRows] = useState<BatchSessionRow[]>(() => loadBatchSession()?.rows ?? []);
  const [running, setRunning] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const portfolioRef = useRef<Portfolio | null>(null);

  useEffect(() => {
    saveBatchSession({ input, rows });
  }, [input, rows]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const start = useCallback(() => {
    const tickers = parseTickers(input);
    if (tickers.length === 0) return;
    esRef.current?.close();
    portfolioRef.current = null;
    setGlobalError(null);
    setRunning(true);
    setRows(tickers.map((t) => ({ ticker: t, stage: "idle", confidence: null, error: null })));
    const url = `/api/batch?tickers=${encodeURIComponent(tickers.join(","))}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (msg) => {
      let evt: BatchEvent;
      try {
        evt = JSON.parse(msg.data) as BatchEvent;
      } catch {
        return;
      }
      if ("event" in evt) {
        if (evt.event === "all_done") {
          es.close();
          esRef.current = null;
          setRunning(false);
        } else if (evt.event === "portfolio") {
          portfolioRef.current = evt.portfolio;
        } else if (evt.event === "portfolio_error") {
          setGlobalError(`Portfolio unavailable: ${evt.error}`);
        }
        return;
      }

      const t = evt.ticker;
      if (evt.stage === "done" && evt.payload) {
        const stitched: BatchTickerPayload = {
          ...evt.payload,
          portfolio: portfolioRef.current,
        };
        saveBatchResult(t, stitched);
      }

      setRows((prev) => {
        let changed = false;
        const next: BatchSessionRow[] = prev.map((r): BatchSessionRow => {
          if (r.ticker !== t) return r;
          if (evt.stage === "done") {
            const stage: Stage = evt.status === "error" ? "error" : "done";
            const error: string | null = evt.status === "error" ? evt.error ?? "Unknown error" : null;
            if (r.stage === stage && r.error === error) return r;
            changed = true;
            return { ...r, stage, error };
          }
          if (evt.status === "error") {
            const error: string = evt.error ?? "Unknown error";
            if (r.stage === "error" && r.error === error) return r;
            changed = true;
            return { ...r, stage: "error", error };
          }
          if (evt.status === "loading") {
            const stage: Stage = evt.stage;
            if (r.stage === stage) return r;
            changed = true;
            return { ...r, stage };
          }
          if (evt.stage === "verdict" && typeof evt.confidence === "number") {
            if (r.confidence === evt.confidence) return r;
            changed = true;
            return { ...r, confidence: evt.confidence };
          }
          return r;
        });
        return changed ? next : prev;
      });
    };

    es.onerror = () => {
      setGlobalError("Stream interrupted. Some tickers may not have finished.");
      es.close();
      esRef.current = null;
      setRunning(false);
    };
  }, [input]);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  }, []);

  const openTickerInNewTab = useCallback((ticker: string) => {
    // sessionStorage is copy-inherited when a tab is opened with window.open or
    // target=_blank, so the new tab sees the saved batch payload at boot and
    // hydrates the Single view from cache without refetching anything.
    window.open(`/?ticker=${encodeURIComponent(ticker)}`, "_blank", "noopener");
  }, []);

  const tickerCount = useMemo(() => parseTickers(input).length, [input]);

  return (
    <div className={styles.batchWrap}>
      <header className={styles.batchHeader}>
        <h1 className="font-display">Batch Analyze</h1>
        <p>
          Fan-out across N tickers with intra-ticker parallel fetches. Results stream back as
          each finishes. Click a card to open it in a new tab with cached results.
        </p>
      </header>

      <section className={styles.batchInputCard}>
        <label className={styles.batchInputLabel}>Tickers</label>
        <textarea
          className={styles.batchInput}
          placeholder="AAPL, MSFT, NVDA, TSLA…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          spellCheck={false}
        />
        <div className={styles.batchInputFooter}>
          <span className={styles.batchInputCount}>
            {tickerCount === 0 ? "No tickers parsed" : `${tickerCount} ticker${tickerCount === 1 ? "" : "s"}`}
          </span>
          <div className={styles.batchInputActions}>
            {running ? (
              <button className={styles.btnGhost} onClick={stop}>
                Stop
              </button>
            ) : (
              <button
                className={styles.btnPrimary}
                onClick={start}
                disabled={tickerCount === 0}
              >
                Analyze
              </button>
            )}
          </div>
        </div>
      </section>

      {globalError && (
        <div className={styles.errorBanner}>
          <strong>Stream warning</strong>
          <span>{globalError}</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className={styles.batchGrid}>
          {rows.map((r) => (
            <BatchCard key={r.ticker} row={r} onOpen={openTickerInNewTab} />
          ))}
        </div>
      )}
    </div>
  );
}

const BatchCard = memo(function BatchCard({
  row,
  onOpen,
}: {
  row: BatchSessionRow;
  onOpen: (ticker: string) => void;
}) {
  const clickable = row.stage === "done";
  const bucket = statusBucket(row.stage);
  return (
    <button
      type="button"
      className={`${styles.batchCard} ${clickable ? styles.batchCardClickable : ""}`}
      onClick={clickable ? () => onOpen(row.ticker) : undefined}
      disabled={!clickable}
    >
      <div className={styles.batchCardHeader}>
        <span className={styles.batchCardTicker}>{row.ticker}</span>
        <span className={`${styles.batchCardStatus} ${STATUS_CLASS[bucket]}`}>{bucket}</span>
      </div>
      <div className={styles.batchCardBody}>
        <div className={styles.batchCardStage}>{STAGE_LABEL[row.stage]}</div>
        {row.stage === "done" && row.confidence != null && (
          <div className={styles.batchCardScore}>
            <span className={styles.batchCardScoreLabel}>Confidence</span>
            <span className={styles.batchCardScoreValue}>{row.confidence}</span>
          </div>
        )}
        {row.stage === "error" && row.error && (
          <div className={styles.batchCardError}>{row.error}</div>
        )}
      </div>
    </button>
  );
});
