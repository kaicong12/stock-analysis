// Fetches every wheel input and assembles the plan, deduping concurrent callers.

import {
  getFundamentals,
  getPriceAction,
  getTechnicalIndicators,
  getVolRegime,
  getWheelChain,
} from "../moomoo/sidecar";
import { fetchFomcDates } from "./fomc";
import { buildWheelPlan } from "./score";
import { computeZone } from "./zone";
import type { WheelPlan } from "./types";

// Concurrent runs must share one plan: OpenD drops chain requests when several hit one connection.
const TTL_MS = 60_000;
const inflight = new Map<string, { at: number; plan: Promise<WheelPlan> }>();

/** Returns the wheel plan for a symbol, reusing an in-flight or recent build. */
export function fetchWheelPlan(ticker: string, symbol: string): Promise<WheelPlan> {
  const hit = inflight.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;

  const plan = buildPlan(ticker, symbol);
  inflight.set(symbol, { at: Date.now(), plan });
  plan.catch(() => inflight.delete(symbol));
  return plan;
}

// Fetches the chain, regime, technicals, price action, fundamentals and FOMC dates in parallel.
async function buildPlan(ticker: string, symbol: string): Promise<WheelPlan> {
  const [chain, regime, tech, priceAction, fundamentals, fomcDates] = await Promise.all([
    getWheelChain(symbol),
    getVolRegime(symbol),
    getTechnicalIndicators(symbol),
    getPriceAction(symbol),
    getFundamentals(symbol).catch(() => null),
    fetchFomcDates(),
  ]);

  const f = fundamentals?.data ?? null;
  return buildWheelPlan({
    symbol,
    ticker,
    chain,
    regime,
    zone: computeZone({
      analystTargetLow: f?.targetLowPrice ?? null,
      sma200: tech?.sma200 ?? null,
      support: tech?.support ?? null,
    }),
    support: tech?.support ?? null,
    resistance: tech?.resistance ?? null,
    supportLevels: tech?.supportLevels ?? [],
    resistanceLevels: tech?.resistanceLevels ?? [],
    sma200: tech?.sma200 ?? null,
    priceAction,
    nextEarningsDate: f?.nextEarningsDate ?? null,
    exDividendDate: f?.exDividendDate ?? null,
    fomcDates,
    forwardEps: f?.forwardEps ?? null,
  });
}
