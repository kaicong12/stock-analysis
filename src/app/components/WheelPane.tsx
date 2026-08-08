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
  if (z === "good") return styles.actionBullish;
  if (z === "rich") return styles.actionBearish;
  return "";
}

function RegimeBlock({ r }: { r: VolRegime | null }) {
  if (!r) return <div className={styles.whatIfNote}>Vol regime unavailable.</div>;
  return (
    <>
      <div className={styles.whatIfRow}>
        <span className={styles.whatIfLabel}>Vol regime</span>
        <span className={"tabular-nums " + (r.label === "rich" ? styles.actionBullish : "")}>
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
      {r.chainError && (
        <div className={styles.wheelWarning}>Chain quotes unavailable — {r.chainError}</div>
      )}
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
  return (
    <tr>
      <td className="tabular-nums">{fmtNum(r.strike)}</td>
      <td className="tabular-nums">{r.delta === null ? "—" : Math.abs(r.delta).toFixed(2)}</td>
      <td className="tabular-nums">{fmtNum(r.bid)}</td>
      <td className="tabular-nums">{fmtNum(r.mid)}</td>
      <td className="tabular-nums">{r.annYield === null ? "—" : `${r.annYield}%`}</td>
      <td className={zoneCls(r.zonePos)}>{ZONE_LABEL[r.zonePos]}</td>
      <td>{r.clearsLevel === null ? "—" : r.clearsLevel ? "✓" : "·"}</td>
    </tr>
  );
}

const TIPS = {
  delta: "Approximate probability of assignment at this strike.",
  bid: "What a buyer is bidding right now — the credit you could actually sell into.",
  mid: "Midpoint of bid and ask. The ann% column is computed from this, so a wide spread means the real fill is lower.",
  put: {
    strike: "The price you'd be obliged to buy at if assigned. Every strike listed is already below the 1-SD expected move.",
    ann: "Annualized yield: mid ÷ strike × 365/DTE. The credit as a yearly rate on the cash a cash-secured put ties up, so expiries of different lengths compare directly. A rate, never a dollar amount — sizing happens at your broker.",
    zone: "Where the strike sits against the acquisition zone. good = below every anchor, a price worth owning at · fair = inside the band · rich = above it, so assignment means overpaying. A label, not a filter: rich strikes are still listed.",
    level: "✓ when the strike sits below nearest support — a second opinion from the chart, independent of the expected move.",
  },
  call: {
    strike: "The price you'd be obliged to sell your shares at if assigned. Every strike listed is already above the 1-SD expected move.",
    ann: "Annualized yield: mid ÷ spot × 365/DTE. Divided by spot, not strike, because the capital committed is the shares you already hold. A rate, never a dollar amount — sizing happens at your broker.",
    zone: "Where the strike sits against the acquisition zone, inverted for a call since this is a price you'd sell at. good = above the band, selling well · fair = inside · rich = below it.",
    level: "✓ when the strike sits above nearest resistance — a second opinion from the chart, independent of the expected move.",
  },
} as const;

function Th({ tip, end, children }: { tip: string; end?: boolean; children: React.ReactNode }) {
  return (
    <th>
      <span className={styles.tip + (end ? " " + styles.tipEnd : "")} data-tip={tip} tabIndex={0}>
        {children}
      </span>
    </th>
  );
}

function LegTable({ legs, side }: { legs: ScoredExpiry[]; side: "put" | "call" }) {
  if (!legs.length) return <div className={styles.whatIfNote}>No quotable strikes.</div>;
  return (
    <>
      {legs.map((e) => (
        <div key={e.expiry} className={styles.wheelExpiry}>
          <div className={styles.wheelExpiryHead}>
            <span className="tabular-nums">
              {e.expiry} · {e.dte}d
            </span>
            <span
              className={styles.whatIfLabel + " " + styles.tip}
              data-tip="The 1-SD expected move: spot × ATM IV × √(DTE/365). Roughly a 68% chance the price stays inside this band by expiry. Only strikes beyond it are listed below."
              tabIndex={0}
            >
              ATM IV {e.atmIv === null ? "—" : `${(e.atmIv * 100).toFixed(1)}%`} · 1-SD{" "}
              {e.emLower === null ? "—" : fmtNum(e.emLower)}–{e.emUpper === null ? "—" : fmtNum(e.emUpper)}
            </span>
            {e.exDivInWindow && <span className={styles.actionBearish}>ex-div in window</span>}
          </div>
          {e.excluded ? (
            <div className={styles.whatIfNote}>Skipped — {e.excluded}.</div>
          ) : !e.rows.length ? (
            <div className={styles.whatIfNote}>No strikes beyond the band.</div>
          ) : (
            <table className={styles.wheelTable + " tabular-nums"}>
              <thead>
                <tr>
                  <Th tip={TIPS[side].strike}>strike</Th>
                  <Th tip={TIPS.delta}>Δ≈</Th>
                  <Th tip={TIPS.bid}>bid</Th>
                  <Th tip={TIPS.mid} end>mid</Th>
                  <Th tip={TIPS[side].ann} end>ann%</Th>
                  <Th tip={TIPS[side].zone} end>zone</Th>
                  <Th tip={TIPS[side].level} end>{side === "put" ? "sup" : "res"}</Th>
                </tr>
              </thead>
              <tbody>
                {e.rows.map((r) => (
                  <StrikeRow key={r.strike} r={r} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  );
}

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
            Only strikes beyond the 1-SD expected move are listed. Δ is approximate assignment
            probability. Sizing happens at your broker.
          </div>
        </>
      )}
    </div>
  );
}
