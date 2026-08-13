// Scores an option chain into the wheel plan's put and call strike tables.

import { daysUntilISO } from "../date";
import type { PriceAction } from "../types";
import { classifyCallStrike, classifyPutStrike } from "./zone";
import type {
  AcquisitionZone,
  ChainExpiry,
  ChainStrike,
  ScoredExpiry,
  ScoredStrike,
  VolRegime,
  WheelChain,
  WheelPlan,
} from "./types";

const MAX_ROWS = 8;

/** Annualizes a credit against the capital the leg commits: strike for a put, spot for a covered call. */
export function annualizedYield(mid: number, basis: number, dte: number): number | null {
  if (!(mid > 0) || !(basis > 0) || !(dte > 0)) return null;
  return Number((((mid / basis) * (365 / dte)) * 100).toFixed(2));
}

interface ScoreContext {
  spot: number;
  zone: AcquisitionZone | null;
  support: number | null;
  resistance: number | null;
  nextEarningsDate: string | null;
  exDividendDate: string | null;
  fomcDates: string[];
  forwardEps: number | null;
}

// Returns this expiry's own ATM IV, taken from the strike nearest spot.
function atmIvOf(expiry: ChainExpiry, spot: number): number | null {
  const legs = [...expiry.puts, ...expiry.calls].filter((r) => r.iv !== null && r.iv > 0);
  if (!legs.length) return null;
  const nearest = legs.reduce((best, r) =>
    Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best,
  );
  return nearest.iv;
}

// Scores one side of an expiry, keeping only strikes beyond the expected-move band.
function scoreRows(
  rows: ChainStrike[],
  dte: number,
  side: "put" | "call",
  bounds: { lower: number | null; upper: number | null },
  ctx: ScoreContext,
): ScoredStrike[] {
  const level = side === "put" ? ctx.support : ctx.resistance;
  const bound = side === "put" ? bounds.lower : bounds.upper;

  // No ATM IV means no band, so pass everything through rather than read empty.
  const beyondBand = bound === null
    ? rows
    : rows.filter((r) => (side === "put" ? r.strike < bound : r.strike > bound));

  const scored: ScoredStrike[] = beyondBand.map((row) => {
    const effective = row.mid > 0
      ? Number((side === "put" ? row.strike - row.mid : row.strike + row.mid).toFixed(2))
      : null;
    return {
      ...row,
      annYield: annualizedYield(row.mid, side === "put" ? row.strike : ctx.spot, dte),
      zonePos: side === "put"
        ? classifyPutStrike(row.strike, ctx.zone)
        : classifyCallStrike(row.strike, ctx.zone),
      clearsLevel: level === null ? null : side === "put" ? row.strike < level : row.strike > level,
      effective,
      effectiveVsSpot: effective === null
        ? null
        : Number((((effective / ctx.spot) - 1) * 100).toFixed(1)),
      peAtEffective: effective === null || !ctx.forwardEps || ctx.forwardEps <= 0
        ? null
        : Number((effective / ctx.forwardEps).toFixed(1)),
    };
  });

  scored.sort((a, b) => (side === "put" ? b.strike - a.strike : a.strike - b.strike));
  return scored.slice(0, MAX_ROWS);
}

// Reports whether an ISO date falls between today and the expiry.
function dateInWindow(iso: string | null, dte: number): boolean {
  const days = daysUntilISO(iso);
  return days !== null && days >= 0 && days <= dte;
}

// Scores one expiry for one leg, marking its events and dropping it when earnings land inside.
function scoreExpiry(expiry: ChainExpiry, side: "put" | "call", ctx: ScoreContext): ScoredExpiry {
  const atmIv = atmIvOf(expiry, ctx.spot);
  const move = atmIv !== null && expiry.dte > 0
    ? ctx.spot * atmIv * Math.sqrt(expiry.dte / 365)
    : null;
  const bounds = {
    lower: move === null ? null : Number((ctx.spot - move).toFixed(2)),
    upper: move === null ? null : Number((ctx.spot + move).toFixed(2)),
  };

  const earningsInWindow = dateInWindow(ctx.nextEarningsDate, expiry.dte);
  // CLAUDE.md forbids an earnings expiry outright, so drop it rather than warn.
  const excluded = earningsInWindow ? "earnings inside the window" : null;

  return {
    expiry: expiry.expiry,
    dte: expiry.dte,
    atmIv,
    emLower: bounds.lower,
    emUpper: bounds.upper,
    earningsInWindow,
    // Ex-div only threatens a short call, via early exercise to capture the div.
    exDivInWindow: side === "call" && dateInWindow(ctx.exDividendDate, expiry.dte),
    // Flagged, never excluded: the Fed meets every ~6 weeks, so a veto would empty every 30-45 DTE expiry.
    fomcInWindow: ctx.fomcDates.some((d) => dateInWindow(d, expiry.dte)),
    excluded,
    rows: excluded
      ? []
      : scoreRows(side === "put" ? expiry.puts : expiry.calls, expiry.dte, side, bounds, ctx),
  };
}

/** Turns a price-action breakdown into a warning, blocking only on a severe one. */
export function breakdownState(pa: PriceAction | null): { warning: string | null; blocked: boolean } {
  if (!pa || pa.signal !== "breakdown") return { warning: null, blocked: false };
  const why = pa.reasons.slice(0, 3).join("; ") || "confirmed downside breakdown";
  if (pa.severity === "severe") {
    return {
      warning: `Severe breakdown — ${why}. Thesis damage rather than a discount; no new put here.`,
      blocked: true,
    };
  }
  return {
    warning: `Breaking down — ${why}. You would be selling into weakness; keep the strike below the acquisition-zone floor.`,
    blocked: false,
  };
}

export interface BuildPlanInput {
  symbol: string;
  ticker: string;
  chain: WheelChain | null;
  regime: VolRegime | null;
  zone: AcquisitionZone | null;
  support: number | null;
  resistance: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  sma200: number | null;
  priceAction: PriceAction | null;
  nextEarningsDate: string | null;
  exDividendDate: string | null;
  fomcDates: string[];
  forwardEps: number | null;
}

/** Assembles the full wheel plan: zone, regime, events, levels and both scored legs. */
export function buildWheelPlan(input: BuildPlanInput): WheelPlan {
  const { warning, blocked } = breakdownState(input.priceAction);
  const spot = input.chain?.spot ?? null;
  const base = {
    symbol: input.symbol,
    ticker: input.ticker,
    spot,
    regime: input.regime,
    zone: input.zone,
    events: {
      earnings: input.nextEarningsDate,
      exDividend: input.exDividendDate,
      fomc: input.fomcDates,
    },
    levels: {
      support: input.supportLevels,
      resistance: input.resistanceLevels,
      sma200: input.sma200,
    },
    forwardEps: input.forwardEps,
    warning,
    blocked,
  };
  if (!input.chain || spot === null || spot <= 0) {
    return { ...base, putLeg: [], callLeg: [] };
  }

  const ctx: ScoreContext = {
    spot,
    zone: input.zone,
    support: input.support,
    resistance: input.resistance,
    nextEarningsDate: input.nextEarningsDate,
    exDividendDate: input.exDividendDate,
    fomcDates: input.fomcDates,
    forwardEps: input.forwardEps,
  };
  return {
    ...base,
    putLeg: input.chain.expiries.map((e) => scoreExpiry(e, "put", ctx)),
    callLeg: input.chain.expiries.map((e) => scoreExpiry(e, "call", ctx)),
  };
}
