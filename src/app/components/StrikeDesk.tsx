"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { daysUntilISO } from "@/lib/date";
import { fmtNum } from "./format";
import type { ScoredExpiry, ScoredStrike, WheelPlan, ZonePosition } from "../../lib/wheel/types";

type Side = "put" | "call";

const RUNWAY_DAYS = 90;

const CAPS = "text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant";
const NOTE = "text-[11px] leading-[1.5] text-on-surface-variant";
const CHIP =
  "inline-flex items-center rounded border border-outline-variant bg-surface-high px-2 py-0.5 text-[11px] font-medium text-on-surface-variant tabular-nums";

const pct = (x: number | null, d = 1): string => (x === null ? "—" : `${(x * 100).toFixed(d)}%`);

const ZONE_LABEL: Record<ZonePosition, string> = { good: "good", fair: "fair", rich: "rich", unknown: "—" };

function zoneCls(z: ZonePosition): string {
  if (z === "good") return "text-bullish";
  if (z === "rich") return "text-bearish";
  return "";
}

function shortDate(iso: string): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" })
    .toUpperCase();
}

interface Scale {
  min: number;
  max: number;
  at: (v: number) => number;
}

function makeScale(values: (number | null)[]): Scale | null {
  const vals = values.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.07 || hi * 0.02;
  const min = lo - pad;
  const max = hi + pad;
  if (max <= min) return null;
  return { min, max, at: (v) => ((v - min) / (max - min)) * 100 };
}

function axisTicks(min: number, max: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  // Snapping the raw span/6 to a single decade jumps to a step twice as coarse
  // as it needs to be right after a decade boundary, so score every candidate
  // across three decades on how close it lands to six divisions.
  const mag = 10 ** Math.floor(Math.log10(span / 6));
  const step = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50]
    .map((m) => m * mag)
    .reduce((best, s) => (Math.abs(span / s - 6) < Math.abs(span / best - 6) ? s : best));
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Number(v.toFixed(2)));
  return out;
}

// Keeps a label inside the plot instead of bleeding past either edge.
function labelPos(p: number, gap = 0): React.CSSProperties {
  if (p < 12) return { left: `${p}%`, marginLeft: gap };
  if (p > 88) return { left: `${p}%`, transform: "translateX(-100%)", marginLeft: -gap };
  return { left: `${p}%`, transform: "translateX(-50%)" };
}

function Hint({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help border-b border-dotted border-outline">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div className={cn(CAPS, "mb-3 leading-none")}>{children}</div>;
}

function Callout({ blocked, children }: { blocked?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded border-l-[3px] bg-surface-high p-2 text-xs leading-normal text-on-surface",
        blocked ? "border-l-bearish" : "border-l-neutral",
      )}
    >
      {children}
    </div>
  );
}

function EventRunway({ plan, expiries }: { plan: WheelPlan; expiries: ScoredExpiry[] }) {
  const at = (iso: string | null): number | null => {
    const d = daysUntilISO(iso);
    if (d === null || d < 0 || d > RUNWAY_DAYS) return null;
    return (d / RUNWAY_DAYS) * 100;
  };

  const earnings = at(plan.events.earnings);
  const exDiv = at(plan.events.exDividend);
  const fomc = plan.events.fomc.map((d) => ({ date: d, p: at(d) })).filter((f) => f.p !== null);

  const dots: { p: number; label: string; tone: "bearish" | "neutral" }[] = [];
  if (exDiv !== null) dots.push({ p: exDiv, label: `Ex-div ${shortDate(plan.events.exDividend!)}`, tone: "neutral" });
  for (const f of fomc) dots.push({ p: f.p!, label: `FOMC ${shortDate(f.date)}`, tone: "neutral" });
  if (earnings !== null) dots.push({ p: earnings, label: `Earnings ${shortDate(plan.events.earnings!)}`, tone: "bearish" });
  dots.sort((a, b) => a.p - b.p);

  return (
    <div>
      <SectionHead>Event runway · next {RUNWAY_DAYS} days</SectionHead>
      <div className="relative h-[86px]">
        <div className="absolute inset-x-0 top-[46px] h-0.5 bg-surface-highest" />
        {earnings !== null && (
          <div
            className="absolute top-[38px] h-[18px] border-l border-bearish/50 bg-bearish-dim"
            style={{ left: `${earnings}%`, right: 0 }}
          />
        )}
        {expiries.map((e) => {
          const p = (Math.min(e.dte, RUNWAY_DAYS) / RUNWAY_DAYS) * 100;
          const muted = e.excluded !== null;
          return (
            <div key={e.expiry}>
              <div
                className={cn("absolute top-4 bottom-10 w-px", muted ? "bg-outline" : "bg-tertiary")}
                style={{ left: `${p}%` }}
              />
              <div
                className={cn(
                  "absolute top-0 text-[10.5px] font-bold tracking-[0.04em] whitespace-nowrap tabular-nums",
                  muted ? "text-on-surface-variant line-through" : "text-tertiary",
                )}
                style={labelPos(p)}
              >
                {shortDate(e.expiry)} · {e.dte}d
              </div>
            </div>
          );
        })}
        {dots.map((d, i) => (
          <div key={`${d.label}-${i}`}>
            <div
              className={cn(
                "absolute top-[41px] -ml-[6px] size-3 rounded-full border-2 bg-surface-container",
                d.tone === "bearish" ? "border-bearish" : "border-neutral",
              )}
              style={{ left: `${d.p}%` }}
            />
            <div
              className={cn(
                "absolute text-[10px] font-semibold tracking-[0.04em] uppercase whitespace-nowrap",
                d.tone === "bearish" ? "text-bearish" : "text-neutral",
              )}
              style={{ ...labelPos(d.p), top: i % 2 === 0 ? 60 : 72 }}
            >
              {d.label}
            </div>
          </div>
        ))}
      </div>
      <div className={cn(NOTE, "mt-1")}>
        Shaded band = expiries dropped in code. Earnings is the only hard block; an FOMC inside the
        window is marked to weigh, not a veto — the Fed meets every ~6 weeks, so almost every 30–45
        DTE expiry contains one.
      </div>
    </div>
  );
}

const LADDER_H = 236;

function PriceLadder({
  plan,
  put,
  call,
  side,
}: {
  plan: WheelPlan;
  put: ScoredExpiry;
  call: ScoredExpiry;
  side: Side;
}) {
  const active = side === "put" ? put : call;
  const other = side === "put" ? call : put;
  const spot = plan.spot;

  const scale = useMemo(
    () =>
      makeScale([
        spot,
        plan.zone?.low ?? null,
        plan.zone?.high ?? null,
        active.emLower,
        active.emUpper,
        ...put.rows.map((r) => r.strike),
        ...call.rows.map((r) => r.strike),
        ...active.rows.map((r) => r.effective),
      ]),
    [spot, plan.zone, active, put.rows, call.rows],
  );

  if (!scale || spot === null) return <div className={NOTE}>Not enough anchors to draw the ladder.</div>;

  const inDomain = (v: number) => v > scale.min && v < scale.max;
  const zone = plan.zone;
  const zoneLo = zone ? scale.at(Math.max(zone.low, scale.min)) : null;
  const zoneHi = zone ? scale.at(Math.min(zone.high, scale.max)) : null;
  const emLo = active.emLower === null ? null : scale.at(Math.max(active.emLower, scale.min));
  const emHi = active.emUpper === null ? null : scale.at(Math.min(active.emUpper, scale.max));

  const levels: { v: number; label: string; cls: string; row: number }[] = [];
  plan.levels.support.slice(0, 3).forEach((v, i) => {
    if (inDomain(v)) levels.push({ v, label: `S${i + 1} ${fmtNum(v)}`, cls: i === 0 ? "bg-bullish" : "bg-bullish/55", row: i });
  });
  plan.levels.resistance.slice(0, 3).forEach((v, i) => {
    if (inDomain(v)) levels.push({ v, label: `R${i + 1} ${fmtNum(v)}`, cls: i === 0 ? "bg-bearish" : "bg-bearish/55", row: i });
  });
  if (plan.levels.sma200 !== null && inDomain(plan.levels.sma200)) {
    levels.push({ v: plan.levels.sma200, label: `SMA200 ${fmtNum(plan.levels.sma200)}`, cls: "bg-outline", row: 1 });
  }

  return (
    <div>
      <SectionHead>
        Price ladder · {active.expiry} · {active.dte} DTE — where each strike sits against every anchor at once
      </SectionHead>
      <div
        className="relative border-x border-outline-variant"
        style={{ height: LADDER_H }}
      >
        {zoneLo !== null && zoneHi !== null && zoneHi > zoneLo && (
          <>
            <div
              className="absolute top-0 bottom-[46px] border-x border-bullish/45 bg-bullish/8"
              style={{ left: `${zoneLo}%`, width: `${zoneHi - zoneLo}%` }}
            />
            <div
              className="absolute top-1 text-center text-[10px] font-bold tracking-[0.05em] uppercase text-bullish"
              style={{ left: `${zoneLo}%`, width: `${zoneHi - zoneLo}%` }}
            >
              Acquisition zone
            </div>
          </>
        )}

        {emLo !== null && emHi !== null && emHi > emLo && (
          <>
            <div
              className="absolute top-10 h-[30px] rounded-[2px] border border-dashed border-tertiary/45 bg-tertiary/7"
              style={{ left: `${emLo}%`, width: `${emHi - emLo}%` }}
            />
            <div
              className="absolute top-12 overflow-hidden text-center text-[10px] font-bold tracking-[0.05em] text-nowrap uppercase text-tertiary"
              style={{ left: `${emLo}%`, width: `${emHi - emLo}%` }}
            >
              1-SD expected move · {fmtNum(active.emLower!)} – {fmtNum(active.emUpper!)}
            </div>
          </>
        )}

        <div
          className="absolute top-[34px] bottom-[46px] -ml-px w-0.5 bg-on-surface"
          style={{ left: `${scale.at(spot)}%` }}
        />
        <div
          className="absolute top-[74px] text-[11px] font-bold whitespace-nowrap text-on-surface tabular-nums"
          style={labelPos(scale.at(spot), 6)}
        >
          Spot {fmtNum(spot)}
        </div>

        {levels.map((l) => (
          <div key={l.label}>
            <div
              className={cn("absolute top-[96px] bottom-[46px] w-px", l.cls)}
              style={{ left: `${scale.at(l.v)}%` }}
            />
            <div
              className="absolute text-[10px] font-semibold whitespace-nowrap text-on-surface-variant tabular-nums"
              style={{ ...labelPos(scale.at(l.v), 5), top: 98 + l.row * 12 }}
            >
              {l.label}
            </div>
          </div>
        ))}

        {other.rows.map((r) => (
          <div
            key={`o-${r.strike}`}
            className="absolute top-[124px] -ml-px h-5 w-0.5 bg-outline/50"
            style={{ left: `${scale.at(r.strike)}%` }}
          />
        ))}

        {active.rows.map((r, i) => {
          const sp = scale.at(r.strike);
          const clears = r.zonePos === "good";
          return (
            <div key={r.strike}>
              <div
                className={cn("absolute top-[124px] -ml-px h-5 w-0.5", clears ? "bg-bullish" : "bg-on-surface")}
                style={{ left: `${sp}%` }}
              />
              <div
                className={cn(
                  "absolute text-[11px] font-bold whitespace-nowrap tabular-nums",
                  clears ? "text-bullish" : "text-on-surface",
                )}
                style={{ ...labelPos(sp), top: i % 2 === 0 ? 146 : 158 }}
              >
                {fmtNum(r.strike)}
              </div>
              {r.effective !== null && (
                <>
                  <div
                    className="absolute top-[178px] h-px bg-tertiary/45"
                    style={{
                      left: `${Math.min(sp, scale.at(r.effective))}%`,
                      width: `${Math.abs(sp - scale.at(r.effective))}%`,
                    }}
                  />
                  <div
                    className="absolute top-[175px] -ml-1 size-2 rounded-full bg-tertiary"
                    style={{ left: `${scale.at(r.effective)}%` }}
                  />
                </>
              )}
            </div>
          );
        })}

        <div className="absolute inset-x-0 top-[206px] h-px bg-outline-variant" />
        {axisTicks(scale.min, scale.max).map((t) => (
          <div
            key={t}
            className="absolute top-[212px] text-[10px] text-on-surface-variant tabular-nums"
            style={labelPos(scale.at(t))}
          >
            {fmtNum(t)}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-on-surface-variant">
        <LegendItem swatch={<span className="h-2 w-2.5 border border-bullish/50 bg-bullish/20" />}>
          Prices worth owning at
        </LegendItem>
        <LegendItem swatch={<span className="h-2 w-2.5 border border-dashed border-tertiary/60" />}>
          68% of outcomes land inside
        </LegendItem>
        <LegendItem swatch={<span className="size-2 rounded-full bg-tertiary" />}>
          {side === "put" ? "Effective basis after the credit" : "Effective sale price after the credit"}
        </LegendItem>
        <LegendItem swatch={<span className="h-2.5 w-0.5 bg-bullish" />}>
          {side === "put" ? "Strike below the zone floor" : "Strike above the zone ceiling"}
        </LegendItem>
      </div>
    </div>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

const TIPS = {
  delta: "Approximate probability of assignment at this strike.",
  bid: "What a buyer is bidding right now — the credit you could actually sell into.",
  mid: "Midpoint of bid and ask. The ann% column is computed from this, so a wide spread means the real fill is lower.",
  put: {
    strike: "The price you'd be obliged to buy at if assigned. Every strike listed is already below the 1-SD expected move.",
    ann: "Annualized yield: mid ÷ strike × 365/DTE. The credit as a yearly rate on the cash a cash-secured put ties up, so expiries of different lengths compare directly. A rate, never a dollar amount — sizing happens at your broker.",
    effective: "Basis = strike − mid. The price you actually own at if assigned, once the credit is counted. This is the number the acquisition zone should be judged against.",
    vsSpot: "How far the basis sits below the current price.",
    pe: "Basis ÷ forward EPS — the multiple you'd actually be buying at, not the multiple the market is paying today.",
    zone: "Where the strike sits against the acquisition zone. good = below every anchor, a price worth owning at · fair = inside the band · rich = above it, so assignment means overpaying. A label, not a filter: rich strikes are still listed.",
    level: "✓ when the strike sits below nearest support — a second opinion from the chart, independent of the expected move.",
  },
  call: {
    strike: "The price you'd be obliged to sell your shares at if assigned. Every strike listed is already above the 1-SD expected move.",
    ann: "Annualized yield: mid ÷ spot × 365/DTE. Divided by spot, not strike, because the capital committed is the shares you already hold. A rate, never a dollar amount — sizing happens at your broker.",
    effective: "Net sale = strike + mid. What you actually receive per share if called away, once the credit is counted.",
    vsSpot: "How far the net sale price sits above the current price.",
    pe: "Net sale ÷ forward EPS — the multiple you'd be exiting at.",
    zone: "Where the strike sits against the acquisition zone, inverted for a call since this is a price you'd sell at. good = above the band, selling well · fair = inside · rich = below it.",
    level: "✓ when the strike sits above nearest resistance — a second opinion from the chart, independent of the expected move.",
  },
} as const;

const CELL = "px-0 py-[5px] pr-2 text-right align-middle first:text-left";
const DIVIDER = "border-l border-surface-highest pl-3";

function Th({ tip, children, className }: { tip: string; children: React.ReactNode; className?: string }) {
  return (
    <TableHead
      className={cn(
        "h-auto px-0 py-[5px] pr-2 text-right text-[10px] font-medium tracking-[0.04em] uppercase text-on-surface-variant first:text-left",
        className,
      )}
    >
      <Hint tip={tip}>{children}</Hint>
    </TableHead>
  );
}

function StrikeTable({ expiry, side, showPe }: { expiry: ScoredExpiry; side: Side; showPe: boolean }) {
  if (expiry.excluded) return <div className={NOTE}>Skipped — {expiry.excluded}.</div>;
  if (!expiry.rows.length) return <div className={NOTE}>No strikes beyond the band.</div>;
  const t = TIPS[side];
  return (
    <Table className="text-[12.5px] leading-normal tabular-nums">
      <TableHeader>
        <TableRow className="border-b border-outline-variant hover:bg-transparent">
          <Th tip={t.strike}>strike</Th>
          <Th tip={TIPS.delta}>Δ≈</Th>
          <Th tip={TIPS.bid}>bid</Th>
          <Th tip={TIPS.mid}>mid</Th>
          <Th tip={t.ann}>ann%</Th>
          <Th tip={t.effective} className={DIVIDER}>
            {side === "put" ? "basis" : "net sale"}
          </Th>
          <Th tip={t.vsSpot}>vs spot</Th>
          {showPe && <Th tip={t.pe}>{side === "put" ? "P/E @ basis" : "P/E @ sale"}</Th>}
          <Th tip={t.zone} className={DIVIDER}>
            zone
          </Th>
          <Th tip={t.level}>{side === "put" ? "sup" : "res"}</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {expiry.rows.map((r) => (
          <StrikeRow key={r.strike} r={r} showPe={showPe} />
        ))}
      </TableBody>
    </Table>
  );
}

function StrikeRow({ r, showPe }: { r: ScoredStrike; showPe: boolean }) {
  const good = r.zonePos === "good";
  return (
    <TableRow className={cn("border-b border-surface-high hover:bg-transparent", good && "bg-bullish/5")}>
      <TableCell className={cn(CELL, good && "font-semibold text-bullish")}>{fmtNum(r.strike)}</TableCell>
      <TableCell className={CELL}>{r.delta === null ? "—" : Math.abs(r.delta).toFixed(2)}</TableCell>
      <TableCell className={CELL}>{fmtNum(r.bid)}</TableCell>
      <TableCell className={CELL}>{fmtNum(r.mid)}</TableCell>
      <TableCell className={CELL}>{r.annYield === null ? "—" : `${r.annYield}%`}</TableCell>
      <TableCell className={cn(CELL, DIVIDER, "font-semibold text-tertiary")}>
        {r.effective === null ? "—" : fmtNum(r.effective)}
      </TableCell>
      <TableCell className={CELL}>
        {r.effectiveVsSpot === null ? "—" : `${r.effectiveVsSpot < 0 ? "−" : "+"}${Math.abs(r.effectiveVsSpot)}%`}
      </TableCell>
      {showPe && (
        <TableCell className={CELL}>{r.peAtEffective === null ? "—" : `${r.peAtEffective}×`}</TableCell>
      )}
      <TableCell className={cn(CELL, DIVIDER, zoneCls(r.zonePos))}>{ZONE_LABEL[r.zonePos]}</TableCell>
      <TableCell className={CELL}>{r.clearsLevel === null ? "—" : r.clearsLevel ? "✓" : "·"}</TableCell>
    </TableRow>
  );
}

function SideToggle({ side, onChange }: { side: Side; onChange: (s: Side) => void }) {
  const opts: { key: Side; label: string }[] = [
    { key: "put", label: "Cash-secured puts" },
    { key: "call", label: "Covered calls" },
  ];
  return (
    <div className="inline-flex gap-1 rounded border border-outline-variant bg-surface-low p-[3px]">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] uppercase transition-colors",
            side === o.key
              ? "bg-surface-highest text-on-surface"
              : "text-on-surface-variant hover:text-on-surface",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ExpiryPanel({ plan, put, call, side, onSide }: {
  plan: WheelPlan;
  put: ScoredExpiry;
  call: ScoredExpiry;
  side: Side;
  onSide: (s: Side) => void;
}) {
  const active = side === "put" ? put : call;
  const blocked = side === "put" && plan.blocked;
  return (
    <div className="flex flex-col gap-5">
      <PriceLadder plan={plan} put={put} call={call} side={side} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SideToggle side={side} onChange={onSide} />
          <div className="flex flex-wrap items-center gap-2">
            {active.fomcInWindow && <span className="text-[11px] text-neutral">FOMC in window</span>}
            {active.exDivInWindow && <span className="text-[11px] text-neutral">ex-div in window</span>}
            <span className={cn(CAPS, "leading-none")}>
              {active.expiry} · {active.dte} DTE
            </span>
          </div>
        </div>

        {side === "call" && (
          <div className={NOTE}>
            <em>Only if you already hold 100+ shares.</em> The app cannot see your positions.
          </div>
        )}

        {blocked ? (
          <div className={NOTE}>Blocked by the severe-breakdown guard.</div>
        ) : (
          <StrikeTable expiry={active} side={side} showPe={plan.forwardEps !== null} />
        )}
      </div>
    </div>
  );
}

export function StrikeDesk({ symbol, ticker }: { symbol: string; ticker: string }) {
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

  return <StrikeDeskView plan={plan} ticker={ticker} state={state} />;
}

export function StrikeDeskView({
  plan,
  ticker,
  state,
}: {
  plan: WheelPlan | null;
  ticker: string;
  state: "loading" | "ready" | "error";
}) {
  const [side, setSide] = useState<Side>("put");

  // The chain's middle tenor is the wheel's home ground; open there.
  const defaultExpiry = useMemo(() => {
    const usable = plan?.putLeg.filter((e) => !e.excluded) ?? [];
    const pool = usable.length ? usable : (plan?.putLeg ?? []);
    if (!pool.length) return null;
    return pool.reduce((best, e) => (Math.abs(e.dte - 30) < Math.abs(best.dte - 30) ? e : best)).expiry;
  }, [plan]);

  const r = plan?.regime ?? null;

  return (
    <Card className="flex flex-col gap-5 border-outline-variant bg-surface-container px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-heading text-[13px] font-semibold tracking-[0.06em] uppercase text-on-surface">
          Strike Desk — {ticker}
        </span>
        {plan?.spot != null && <span className={CHIP}>Spot {fmtNum(plan.spot)}</span>}
        {plan?.zone && (
          <span className={CHIP}>
            Zone {fmtNum(plan.zone.low)} – {fmtNum(plan.zone.high)}
            {plan.zone.partial ? " (partial)" : ""}
          </span>
        )}
        {r && (
          <Hint tip="Premium richness. The percentile ranks realized vol against its own trailing year — a proxy for IV Rank, not IV Rank. Never a gate: thin premium is a downgrade to the pay, not a reason to skip a price worth owning.">
            <span className={CHIP}>
              Vol {r.label} · IV/HV {r.ivHv30 === null ? "—" : `${r.ivHv30.toFixed(2)}×`} · HV pct{" "}
              {r.hv30Pct === null ? "—" : `${r.hv30Pct}th`}
            </span>
          </Hint>
        )}
        <span className={cn(NOTE, "ml-auto")}>Arithmetic only — no model reads this section.</span>
      </div>

      {state === "loading" && <div className={NOTE}>Loading chain &amp; levels…</div>}
      {state === "error" && <div className={NOTE}>Wheel data unavailable.</div>}

      {state === "ready" && plan && (
        <>
          {plan.warning && <Callout blocked={plan.blocked}>{plan.warning}</Callout>}
          {r?.chainError && <Callout>Chain quotes unavailable — {r.chainError}</Callout>}

          <EventRunway plan={plan} expiries={plan.putLeg} />

          {defaultExpiry === null ? (
            <div className={NOTE}>No quotable expiries.</div>
          ) : (
            <Tabs defaultValue={defaultExpiry} className="gap-4">
              <TabsList variant="line" className="h-auto flex-wrap justify-start gap-1 border-b border-outline-variant p-0">
                {plan.putLeg.map((e) => (
                  <TabsTrigger
                    key={e.expiry}
                    value={e.expiry}
                    className="h-auto flex-none px-3 py-1.5 text-[11px] font-semibold tracking-[0.04em] uppercase tabular-nums after:bottom-[-1px] data-[state=active]:text-tertiary data-[state=active]:after:bg-tertiary"
                  >
                    {shortDate(e.expiry)} · {e.dte}d
                    {e.excluded && <span className="text-bearish"> ✕</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
              {plan.putLeg.map((e, i) => (
                <TabsContent key={e.expiry} value={e.expiry}>
                  <ExpiryPanel
                    plan={plan}
                    put={e}
                    call={plan.callLeg[i]}
                    side={side}
                    onSide={setSide}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}

          <div className={cn(NOTE, "flex flex-wrap gap-x-5 gap-y-1 border-t border-outline-variant pt-3")}>
            <span>
              Only strikes beyond the 1-SD expected move are listed. Δ is approximate assignment
              probability.
            </span>
            {plan.zone && (
              <span>
                Zone anchors: target-low{" "}
                {plan.zone.anchors.analystTargetLow === null ? "—" : fmtNum(plan.zone.anchors.analystTargetLow)} · SMA200{" "}
                {plan.zone.anchors.sma200 === null ? "—" : fmtNum(plan.zone.anchors.sma200)} · support{" "}
                {plan.zone.anchors.support === null ? "—" : fmtNum(plan.zone.anchors.support)}
              </span>
            )}
            {r && (
              <span>
                HV30 {pct(r.hv30)} · ATM IV {pct(r.atmIv)}
              </span>
            )}
            <span>Sizing happens at your broker.</span>
          </div>
        </>
      )}
    </Card>
  );
}
