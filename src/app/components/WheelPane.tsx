"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";
import { fmtNum } from "./format";
import { IconPlay } from "./icons";
import type {
  ScoredExpiry,
  ScoredStrike,
  VolRegime,
  WheelPlan,
  ZonePosition,
} from "../../lib/wheel/types";

const pct = (x: number | null, d = 1): string => (x === null ? "—" : `${(x * 100).toFixed(d)}%`);

const ZONE_LABEL: Record<ZonePosition, string> = {
  good: "good",
  fair: "fair",
  rich: "rich",
  unknown: "—",
};

function zoneCls(z: ZonePosition): string {
  if (z === "good") return styles.bullish;
  if (z === "rich") return styles.bearish;
  return "";
}

function RegimeBlock({ r }: { r: VolRegime | null }) {
  if (!r) return <div className={styles.whatIfNote}>Vol regime unavailable.</div>;
  return (
    <>
      <div className={styles.whatIfRow}>
        <span className={styles.whatIfLabel}>Vol regime</span>
        <span className={"tabular-nums " + (r.label === "rich" ? styles.bullish : r.label === "thin" ? styles.bearish : "")}>
          {r.label}
        </span>
      </div>
      <div className={styles.whatIfRow}>
        <span className={styles.whatIfLabel}>HV30 · percentile</span>
        <span className="tabular-nums">
          {pct(r.hv30)} · {r.hv30Pct === null ? "—" : `${r.hv30Pct}th`}
          {r.hv30Low !== null && r.hv30High !== null ? ` (${pct(r.hv30Low)}–${pct(r.hv30High)})` : ""}
        </span>
      </div>
      <div className={styles.whatIfRow}>
        <span className={styles.whatIfLabel}>ATM IV · IV/HV</span>
        <span className="tabular-nums">
          {pct(r.atmIv)} · {r.ivHv30 === null ? "—" : `${r.ivHv30.toFixed(2)}×`}
        </span>
      </div>
      <div className={styles.whatIfSub}>
        Percentile ranks <em>realized</em> vol against its own year — a proxy for IV Rank, not IV Rank.
      </div>
    </>
  );
}

function ZoneBlock({ plan }: { plan: WheelPlan }) {
  const z = plan.zone;
  if (!z) {
    return <div className={styles.whatIfNote}>Acquisition zone unavailable — fewer than two anchors.</div>;
  }
  const a = z.anchors;
  return (
    <>
      <div className={styles.whatIfRow}>
        <span className={styles.whatIfLabel}>Acquisition zone{z.partial ? " (partial)" : ""}</span>
        <span className="tabular-nums">
          {fmtNum(z.low)} – {fmtNum(z.high)}
        </span>
      </div>
      <div className={styles.whatIfSub}>
        target-low {a.analystTargetLow === null ? "—" : fmtNum(a.analystTargetLow)} · SMA200{" "}
        {a.sma200 === null ? "—" : fmtNum(a.sma200)} · support {a.support === null ? "—" : fmtNum(a.support)}
      </div>
    </>
  );
}

function StrikeRow({ r }: { r: ScoredStrike }) {
  const mark = r.safest ? "↓ safest" : r.richest ? "$ richest" : "";
  return (
    <tr>
      <td className="tabular-nums">{fmtNum(r.strike)}</td>
      <td className="tabular-nums">{r.delta === null ? "—" : Math.abs(r.delta).toFixed(2)}</td>
      <td className="tabular-nums">{fmtNum(r.mid)}</td>
      <td className="tabular-nums">{r.annYield === null ? "—" : `${r.annYield}%`}</td>
      <td className={zoneCls(r.zonePos)}>{ZONE_LABEL[r.zonePos]}</td>
      <td>{r.clearsEm === null ? "—" : r.clearsEm ? "✓" : "·"}</td>
      <td>{r.clearsLevel === null ? "—" : r.clearsLevel ? "✓" : "·"}</td>
      <td className={styles.wheelMark}>{mark}</td>
    </tr>
  );
}

function LegTable({ legs, side }: { legs: ScoredExpiry[]; side: "put" | "call" }) {
  const withRows = legs.filter((e) => e.rows.length);
  if (!withRows.length) return <div className={styles.whatIfNote}>No quotable strikes.</div>;
  return (
    <>
      {withRows.map((e) => (
        <div key={e.expiry} className={styles.wheelExpiry}>
          <div className={styles.wheelExpiryHead}>
            <span className="tabular-nums">
              {e.expiry} · {e.dte}d
            </span>
            <span className={styles.whatIfLabel}>
              1-SD {e.emLower === null ? "—" : fmtNum(e.emLower)}–{e.emUpper === null ? "—" : fmtNum(e.emUpper)}
            </span>
            {e.earningsInWindow && <span className={styles.bearish}>earnings in window</span>}
            {e.exDivInWindow && <span className={styles.bearish}>ex-div in window</span>}
          </div>
          <table className={styles.wheelTable + " tabular-nums"}>
            <thead>
              <tr>
                <th>strike</th>
                <th title="approximate assignment probability">Δ≈</th>
                <th>mid</th>
                <th>ann%</th>
                <th>zone</th>
                <th title="clears the 1-SD expected move">EM</th>
                <th title={side === "put" ? "clears support" : "clears resistance"}>
                  {side === "put" ? "sup" : "res"}
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {e.rows.map((r) => (
                <StrikeRow key={r.strike} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

// Deterministic wheel read for the ticker under analysis: vol regime, the
// acquisition zone, and the scored strike tables for both legs. Replaces the
// hand-typed expected-move calculator — these are live chain quotes.
export function WheelPane({ symbol, ticker }: { symbol: string; ticker: string }) {
  const [plan, setPlan] = useState<WheelPlan | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/wheel?symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { plan: WheelPlan };
        if (alive) {
          setPlan(json.plan);
          setState("ready");
        }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [symbol]);

  return (
    <div className={styles.whatIf}>
      <div className={styles.whatIfHeader}>
        <IconPlay /> Wheel entry — {ticker}
      </div>

      {state === "loading" && <div className={styles.whatIfNote}>Loading chain &amp; levels…</div>}
      {state === "error" && <div className={styles.whatIfNote}>Wheel data unavailable.</div>}

      {state === "ready" && plan && (
        <>
          <div className={styles.whatIfRow}>
            <span className={styles.whatIfLabel}>Spot</span>
            <span className="tabular-nums">{plan.spot === null ? "—" : fmtNum(plan.spot)}</span>
          </div>
          <RegimeBlock r={plan.regime} />
          <ZoneBlock plan={plan} />

          {plan.warning && (
            <div className={plan.blocked ? styles.wheelBlocked : styles.wheelWarning}>{plan.warning}</div>
          )}

          <div className={styles.wheelLegHead}>Sell cash-secured put — start the wheel</div>
          {plan.blocked ? (
            <div className={styles.whatIfNote}>Blocked by the severe-breakdown guard.</div>
          ) : (
            <LegTable legs={plan.putLeg} side="put" />
          )}

          <div className={styles.wheelLegHead}>
            Sell covered call — <em>only if you hold 100+ shares</em>
          </div>
          <LegTable legs={plan.callLeg} side="call" />

          <div className={styles.whatIfSub}>
            Δ is approximate assignment probability. Sizing happens at your broker.
          </div>
        </>
      )}
    </div>
  );
}
