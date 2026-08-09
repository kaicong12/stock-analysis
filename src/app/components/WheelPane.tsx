"use client";

import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fmtNum } from "./format";
import { Play } from "lucide-react";
import type { ScoredExpiry, ScoredStrike, VolRegime, WheelPlan, ZonePosition } from "../../lib/wheel/types";

const pct = (x: number | null, d = 1): string => (x === null ? "—" : `${(x * 100).toFixed(d)}%`);

const ZONE_LABEL: Record<ZonePosition, string> = {
  good: "good",
  fair: "fair",
  rich: "rich",
  unknown: "—",
};

function zoneCls(z: ZonePosition): string {
  if (z === "good") return "text-bullish";
  if (z === "rich") return "text-bearish";
  return "";
}

const ROW = "flex justify-between gap-3 text-xs leading-normal text-on-surface";
const LABEL = "text-on-surface-variant";
const SUB = "text-[11px] text-on-surface-variant";
const NOTE = "text-[11px] text-on-surface-variant";
const CELL = "px-0 py-[3px] pr-1.5 text-right align-middle first:text-left";

function RegimeBlock({ r }: { r: VolRegime | null }) {
  if (!r) return <div className={NOTE}>Vol regime unavailable.</div>;
  return (
    <>
      <div className={ROW}>
        <span className={LABEL}>Vol regime</span>
        <span className={cn("tabular-nums", r.label === "rich" && "text-bullish")}>{r.label}</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>HV30 · percentile</span>
        <span className="tabular-nums">
          {pct(r.hv30)} · {r.hv30Pct === null ? "—" : `${r.hv30Pct}th`}
          {r.hv30Low !== null && r.hv30High !== null ? ` (${pct(r.hv30Low)}–${pct(r.hv30High)})` : ""}
        </span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>ATM IV · IV/HV</span>
        <span className="tabular-nums">
          {pct(r.atmIv)} · {r.ivHv30 === null ? "—" : `${r.ivHv30.toFixed(2)}×`}
        </span>
      </div>
      <div className={SUB}>
        Percentile ranks <em>realized</em> vol against its own year — a proxy for IV Rank, not IV Rank.
      </div>
      {r.chainError && <Callout>Chain quotes unavailable — {r.chainError}</Callout>}
    </>
  );
}

function Callout({ blocked, children }: { blocked?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mt-1 rounded border-l-[3px] bg-surface-high p-2 text-xs leading-normal text-on-surface",
        blocked ? "border-l-bearish" : "border-l-neutral",
      )}
    >
      {children}
    </div>
  );
}

function ZoneBlock({ plan }: { plan: WheelPlan }) {
  const z = plan.zone;
  if (!z) return <div className={NOTE}>Acquisition zone unavailable — fewer than two anchors.</div>;
  const a = z.anchors;
  return (
    <>
      <div className={ROW}>
        <span className={LABEL}>Acquisition zone{z.partial ? " (partial)" : ""}</span>
        <span className="tabular-nums">
          {fmtNum(z.low)} – {fmtNum(z.high)}
        </span>
      </div>
      <div className={SUB}>
        target-low {a.analystTargetLow === null ? "—" : fmtNum(a.analystTargetLow)} · SMA200{" "}
        {a.sma200 === null ? "—" : fmtNum(a.sma200)} · support {a.support === null ? "—" : fmtNum(a.support)}
      </div>
    </>
  );
}

function StrikeRow({ r }: { r: ScoredStrike }) {
  return (
    <TableRow className="border-0 hover:bg-transparent">
      <TableCell className={cn(CELL, "tabular-nums")}>{fmtNum(r.strike)}</TableCell>
      <TableCell className={cn(CELL, "tabular-nums")}>
        {r.delta === null ? "—" : Math.abs(r.delta).toFixed(2)}
      </TableCell>
      <TableCell className={cn(CELL, "tabular-nums")}>{fmtNum(r.bid)}</TableCell>
      <TableCell className={cn(CELL, "tabular-nums")}>{fmtNum(r.mid)}</TableCell>
      <TableCell className={cn(CELL, "tabular-nums")}>
        {r.annYield === null ? "—" : `${r.annYield}%`}
      </TableCell>
      <TableCell className={cn(CELL, zoneCls(r.zonePos))}>{ZONE_LABEL[r.zonePos]}</TableCell>
      <TableCell className={CELL}>{r.clearsLevel === null ? "—" : r.clearsLevel ? "✓" : "·"}</TableCell>
    </TableRow>
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

function Hint({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help border-b border-dotted border-outline">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function Th({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <TableHead className="h-auto px-0 py-[3px] pr-1.5 text-right text-[10px] font-medium tracking-[0.04em] uppercase text-on-surface-variant first:text-left">
      <Hint tip={tip}>{children}</Hint>
    </TableHead>
  );
}

function LegTable({ legs, side }: { legs: ScoredExpiry[]; side: "put" | "call" }) {
  if (!legs.length) return <div className={NOTE}>No quotable strikes.</div>;
  return (
    <>
      {legs.map((e) => (
        <div key={e.expiry} className="mt-2">
          <div className="flex flex-wrap items-baseline gap-2.5 text-[11px] text-on-surface">
            <span className="tabular-nums">
              {e.expiry} · {e.dte}d
            </span>
            <Hint tip="The 1-SD expected move: spot × ATM IV × √(DTE/365). Roughly a 68% chance the price stays inside this band by expiry. Only strikes beyond it are listed below.">
              <span className={LABEL}>
                ATM IV {e.atmIv === null ? "—" : `${(e.atmIv * 100).toFixed(1)}%`} · 1-SD{" "}
                {e.emLower === null ? "—" : fmtNum(e.emLower)}–{e.emUpper === null ? "—" : fmtNum(e.emUpper)}
              </span>
            </Hint>
            {e.exDivInWindow && <span className="text-bearish">ex-div in window</span>}
          </div>
          {e.excluded ? (
            <div className={NOTE}>Skipped — {e.excluded}.</div>
          ) : !e.rows.length ? (
            <div className={NOTE}>No strikes beyond the band.</div>
          ) : (
            <Table className="mt-1 text-xs leading-normal tabular-nums">
              <TableHeader>
                <TableRow className="border-b border-outline-variant hover:bg-transparent">
                  <Th tip={TIPS[side].strike}>strike</Th>
                  <Th tip={TIPS.delta}>Δ≈</Th>
                  <Th tip={TIPS.bid}>bid</Th>
                  <Th tip={TIPS.mid}>mid</Th>
                  <Th tip={TIPS[side].ann}>ann%</Th>
                  <Th tip={TIPS[side].zone}>zone</Th>
                  <Th tip={TIPS[side].level}>{side === "put" ? "sup" : "res"}</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {e.rows.map((r) => (
                  <StrikeRow key={r.strike} r={r} />
                ))}
              </TableBody>
            </Table>
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
    <div className="mt-3 flex flex-col gap-2 rounded border border-outline-variant bg-surface-container p-3">
      <div className="flex items-center gap-1.5 text-xs leading-normal font-semibold tracking-[0.04em] uppercase text-on-surface">
        <Play className="size-3 fill-current" /> Wheel entry — {ticker}
      </div>

      {state === "loading" && <div className={NOTE}>Loading chain &amp; levels…</div>}
      {state === "error" && <div className={NOTE}>Wheel data unavailable.</div>}

      {state === "ready" && plan && (
        <>
          <div className={ROW}>
            <span className={LABEL}>Spot</span>
            <span className="tabular-nums">{plan.spot === null ? "—" : fmtNum(plan.spot)}</span>
          </div>
          <RegimeBlock r={plan.regime} />
          <ZoneBlock plan={plan} />

          {plan.warning && <Callout blocked={plan.blocked}>{plan.warning}</Callout>}

          <LegHead>Sell cash-secured put — start the wheel</LegHead>
          {plan.blocked ? (
            <div className={NOTE}>Blocked by the severe-breakdown guard.</div>
          ) : (
            <LegTable legs={plan.putLeg} side="put" />
          )}

          <LegHead>
            Sell covered call — <em>only if you hold 100+ shares</em>
          </LegHead>
          <LegTable legs={plan.callLeg} side="call" />

          <div className={SUB}>
            Only strikes beyond the 1-SD expected move are listed. Δ is approximate assignment
            probability. Sizing happens at your broker.
          </div>
        </>
      )}
    </div>
  );
}

function LegHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2.5 border-t border-outline-variant pt-2 text-[11px] font-semibold tracking-[0.04em] uppercase text-on-surface">
      {children}
    </div>
  );
}
