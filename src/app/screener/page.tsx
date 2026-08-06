"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import styles from "./screener.module.css";
import { SCREENER_DEFAULTS } from "../../lib/types";
import type {
  ScreenerCandidate,
  ScreenerFunnel,
  ScreenerReject,
  ScreenerResult,
} from "../../lib/types";

const pct = (n: number | null, digits = 0) =>
  n === null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;
const num = (n: number | null, digits = 2) =>
  n === null || !Number.isFinite(n) ? "—" : n.toFixed(digits);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
const capBn = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : `$${(n / 1e9).toFixed(0)}B`;

const EVENT_REASONS = new Set(["earnings", "fomc"]);

function Candidates({ rows }: { rows: ScreenerCandidate[] }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Spot</th>
            <th>IVR</th>
            <th>IV/HV</th>
            <th>Expiry</th>
            <th>DTE</th>
            <th>Events</th>
            <th>Short</th>
            <th>Long</th>
            <th>Credit</th>
            <th>Cr/W</th>
            <th>Cost basis</th>
            <th>Cushion</th>
            <th>1σ floor</th>
            <th>Support</th>
            <th>Δ</th>
            <th>OTM</th>
            <th>OI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.symbol}-${c.expiry}-${c.shortStrike}`}>
              <td>
                <span className={styles.sym}>{c.symbol.replace(/^US\./, "")}</span>{" "}
                <span className={styles.subtle}>{c.name}</span>
              </td>
              <td>{num(c.spot)}</td>
              <td>{pct(c.ivRank)}</td>
              <td className={c.ivHv !== null && c.ivHv < 1 ? styles.bad : styles.good}>
                {num(c.ivHv)}
              </td>
              <td>{c.expiry}</td>
              <td>{c.dte}</td>
              <td>
                {c.fomcInWindow ? (
                  <span className={`${styles.chip} ${styles.chipEvent}`}>
                    FOMC {c.fomcInWindow.slice(5)}
                  </span>
                ) : (
                  <span className={styles.subtle}>—</span>
                )}
              </td>
              <td>{num(c.shortStrike)}</td>
              <td>{num(c.longStrike)}</td>
              <td>{num(c.credit)}</td>
              <td className={styles.good}>{pct(c.creditWidth)}</td>
              <td>{num(c.costBasis)}</td>
              <td>{num(c.cushionPct, 1)}%</td>
              <td>{num(c.expectedMoveFloor)}</td>
              <td>{num(c.support)}</td>
              <td>{num(c.delta, 3)}</td>
              <td>{pct(c.otmProbability)}</td>
              <td>{c.openInterest?.toLocaleString() ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rejects({ rows }: { rows: ScreenerReject[] }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Cap</th>
            <th>Price</th>
            <th>IVR</th>
            <th>IV</th>
            <th>HV</th>
            <th>IV/HV</th>
            <th>Rejected on</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>
                <span className={styles.sym}>{r.symbol.replace(/^US\./, "")}</span>{" "}
                <span className={styles.subtle}>{r.name}</span>
              </td>
              <td>{capBn(r.marketCap)}</td>
              <td>{num(r.price)}</td>
              <td>{pct(r.ivRank)}</td>
              <td>{pct(r.iv, 1)}</td>
              <td>{pct(r.hv, 1)}</td>
              <td className={r.ivHv !== null && r.ivHv < 1 ? styles.bad : undefined}>
                {num(r.ivHv)}
              </td>
              <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                <span
                  className={`${styles.chip} ${
                    EVENT_REASONS.has(r.reason) ? styles.chipEvent : styles.chipLevel
                  }`}
                >
                  {r.reason.replace(/_/g, " ")}
                </span>{" "}
                <span className={styles.subtle}>{r.detail}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Funnel({ data }: { data: ScreenerFunnel }) {
  const top = data.steps[0]?.contracts || 1;
  return (
    <div style={{ paddingBottom: 8 }}>
      {data.steps.map((s) => (
        <div key={s.gate} className={styles.funnelRow}>
          <span>{s.gate}</span>
          <span className={styles.funnelCount}>{s.contracts.toLocaleString()}</span>
          <span
            className={styles.funnelBar}
            style={{ width: `${Math.max((s.contracts / top) * 100, 0.5)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function ScreenerPage() {
  const [dteMin, setDteMin] = useState<number>(SCREENER_DEFAULTS.dteMin);
  const [dteMax, setDteMax] = useState<number>(SCREENER_DEFAULTS.dteMax);
  const [result, setResult] = useState<ScreenerResult | null>(null);
  const [funnel, setFunnel] = useState<ScreenerFunnel | null>(null);
  const [loading, setLoading] = useState(false);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFunnel(null);
    try {
      const res = await fetch(`/api/screener?dteMin=${dteMin}&dteMax=${dteMax}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      setResult(body as ScreenerResult);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [dteMin, dteMax]);

  const loadFunnel = useCallback(async () => {
    setFunnelLoading(true);
    try {
      const res = await fetch(`/api/screener/funnel?dteMin=${dteMin}&dteMax=${dteMax}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      setFunnel(body as ScreenerFunnel);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFunnelLoading(false);
    }
  }, [dteMin, dteMax]);

  const c = result?.criteria;

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>Credit Spread Screener</div>
          {c && (
            <div className={styles.meta}>
              IVR ≥ {pct(c.minIvRank)} · IV/HV ≥ {c.minIvHv.toFixed(2)} · Δ {c.delta[0]} to{" "}
              {c.delta[1]} · OTM ≥ {pct(c.minOtmProbability)} · OI ≥{" "}
              {c.minOpenInterest.toLocaleString()} · credit/width ≥ {pct(c.minCreditWidth)} ·
              listed ≥ {c.minListingYears}y
            </div>
          )}
        </div>
        <Link href="/" className={styles.back}>
          ← Dashboard
        </Link>
      </div>

      <div className={styles.controls}>
        <label className={styles.field}>
          DTE
          <input
            className={styles.input}
            type="number"
            value={dteMin}
            onChange={(e) => setDteMin(Number(e.target.value))}
          />
          to
          <input
            className={styles.input}
            type="number"
            value={dteMax}
            onChange={(e) => setDteMax(Number(e.target.value))}
          />
        </label>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={run}
          disabled={loading}
        >
          {loading ? "Scanning…" : "Run screen"}
        </button>
        <button className={styles.btn} onClick={loadFunnel} disabled={funnelLoading}>
          {funnelLoading ? "Counting…" : "Show funnel"}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {result?.fomcCalendarStale && (
        <div className={styles.error}>
          The FOMC calendar in <code>python_backend/fomc.py</code> does not cover the whole
          expiry window — the FOMC veto was not applied to every candidate. Refresh it from
          federalreserve.gov.
        </div>
      )}

      {result && (
        <>
          <section className={styles.pane}>
            <div className={styles.paneHead}>
              <span className={styles.paneTitle}>
                Candidates ({result.candidates.length})
              </span>
              <span className={styles.meta}>
                {plural(result.screened, "contract")} → {plural(result.universe, "underlying", "underlyings")}{" "}
                · {result.asOf}
              </span>
            </div>
            {result.candidates.length ? (
              <Candidates rows={result.candidates} />
            ) : (
              <div className={styles.empty}>
                <div className={styles.emptyLead}>Nothing passes today.</div>
                Zero is a normal result for these thresholds. Check the funnel below to
                confirm the screen ran — and the rejects to see how each name failed.
              </div>
            )}
            <div className={styles.note}>
              Cost basis = short strike − net credit: the per-share price assignment would
              leave you holding at. Credit is quoted conservatively (short leg at bid, long
              leg at ask). Entry-or-pass only — sizing happens at your broker.
            </div>
          </section>

          {result.rejects.length > 0 && (
            <section className={styles.pane}>
              <div className={styles.paneHead}>
                <span className={styles.paneTitle}>
                  Screened out ({result.rejects.length})
                </span>
                <span className={styles.meta}>red = binary event · amber = level/quality</span>
              </div>
              <Rejects rows={result.rejects} />
            </section>
          )}
        </>
      )}

      {funnel && (
        <section className={styles.pane}>
          <div className={styles.paneHead}>
            <span className={styles.paneTitle}>Universe funnel</span>
            <span className={styles.meta}>{funnel.asOf}</span>
          </div>
          <Funnel data={funnel} />
        </section>
      )}
    </main>
  );
}
