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

const MIN_OPEN_INTEREST = 500;
const MAX_SPREAD_PCT = 10;

// A percentage, not a dollar figure: the app has no NAV or position data, so
// absolute risk numbers are both unavailable and forbidden (CLAUDE.md).
export function annualizedYield(mid: number, strike: number, dte: number): number | null {
  if (!(mid > 0) || !(strike > 0) || !(dte > 0)) return null;
  return Number((((mid / strike) * (365 / dte)) * 100).toFixed(2));
}

function isLiquid(row: ChainStrike): boolean | null {
  if (row.openInterest === null && row.spreadPct === null) return null;
  const oiOk = row.openInterest === null ? true : row.openInterest >= MIN_OPEN_INTEREST;
  const spreadOk = row.spreadPct === null ? true : row.spreadPct <= MAX_SPREAD_PCT;
  return oiOk && spreadOk;
}

interface ScoreContext {
  spot: number;
  zone: AcquisitionZone | null;
  support: number | null;
  resistance: number | null;
  nextEarningsDate: string | null;
  exDividendDate: string | null;
}

// ATM IV of the expiry itself, so the expected move matches the contract being
// scored rather than a generic 30-day sample.
function atmIvOf(expiry: ChainExpiry, spot: number): number | null {
  const legs = [...expiry.puts, ...expiry.calls].filter((r) => r.iv !== null && r.iv > 0);
  if (!legs.length) return null;
  const nearest = legs.reduce((best, r) =>
    Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best,
  );
  return nearest.iv;
}

function scoreRows(
  rows: ChainStrike[],
  dte: number,
  side: "put" | "call",
  bounds: { lower: number | null; upper: number | null },
  ctx: ScoreContext,
): ScoredStrike[] {
  const level = side === "put" ? ctx.support : ctx.resistance;
  const bound = side === "put" ? bounds.lower : bounds.upper;

  const scored: ScoredStrike[] = rows.map((row) => ({
    ...row,
    annYield: annualizedYield(row.mid, row.strike, dte),
    zonePos: side === "put"
      ? classifyPutStrike(row.strike, ctx.zone)
      : classifyCallStrike(row.strike, ctx.zone),
    clearsEm: bound === null ? null : side === "put" ? row.strike < bound : row.strike > bound,
    clearsLevel: level === null ? null : side === "put" ? row.strike < level : row.strike > level,
    liquid: isLiquid(row),
    safest: false,
    richest: false,
  }));

  // Ranked by distance rather than delta so it survives a missing greek.
  const tradeable = scored.filter((r) => r.liquid !== false && (r.annYield ?? 0) > 0);
  const safest = tradeable.reduce<ScoredStrike | null>((best, r) => {
    if (!best) return r;
    return side === "put" ? (r.strike < best.strike ? r : best) : (r.strike > best.strike ? r : best);
  }, null);
  if (safest) safest.safest = true;

  // "rich" is excluded whatever it pays — being paid well to transact at a bad
  // price is the trap this pane exists to prevent.
  const acceptable = tradeable.filter((r) => r.zonePos !== "rich");
  const richest = acceptable.reduce<ScoredStrike | null>((best, r) => {
    if (r.annYield === null) return best;
    if (!best || best.annYield === null) return r;
    return r.annYield > best.annYield ? r : best;
  }, null);
  if (richest) richest.richest = true;

  return scored.sort((a, b) => (side === "put" ? b.strike - a.strike : a.strike - b.strike));
}

function dateInWindow(iso: string | null, dte: number): boolean {
  const days = daysUntilISO(iso);
  return days !== null && days >= 0 && days <= dte;
}

function scoreExpiry(expiry: ChainExpiry, side: "put" | "call", ctx: ScoreContext): ScoredExpiry {
  const atmIv = atmIvOf(expiry, ctx.spot);
  const move = atmIv !== null && expiry.dte > 0
    ? ctx.spot * atmIv * Math.sqrt(expiry.dte / 365)
    : null;
  const bounds = {
    lower: move === null ? null : Number((ctx.spot - move).toFixed(2)),
    upper: move === null ? null : Number((ctx.spot + move).toFixed(2)),
  };

  return {
    expiry: expiry.expiry,
    dte: expiry.dte,
    atmIv,
    emLower: bounds.lower,
    emUpper: bounds.upper,
    earningsInWindow: dateInWindow(ctx.nextEarningsDate, expiry.dte),
    // Ex-div only threatens a short call, via early exercise to capture the div.
    exDivInWindow: side === "call" && dateInWindow(ctx.exDividendDate, expiry.dte),
    rows: scoreRows(side === "put" ? expiry.puts : expiry.calls, expiry.dte, side, bounds, ctx),
  };
}

// Softened from the old hard veto: an investor who wants the shares is partly
// buying the dip, so mild warns and only severe (thesis damage) blocks.
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
  priceAction: PriceAction | null;
  nextEarningsDate: string | null;
  exDividendDate: string | null;
}

export function buildWheelPlan(input: BuildPlanInput): WheelPlan {
  const { warning, blocked } = breakdownState(input.priceAction);
  const spot = input.chain?.spot ?? null;
  const base = {
    symbol: input.symbol,
    ticker: input.ticker,
    spot,
    regime: input.regime,
    zone: input.zone,
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
  };
  return {
    ...base,
    putLeg: input.chain.expiries.map((e) => scoreExpiry(e, "put", ctx)),
    callLeg: input.chain.expiries.map((e) => scoreExpiry(e, "call", ctx)),
  };
}
