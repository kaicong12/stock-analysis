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

// Three callers per analysis at ~12 OpenD round-trips each; run concurrently on
// one connection the chain leg fails intermittently and the plan comes back empty.
const TTL_MS = 60_000;
const inflight = new Map<string, { at: number; plan: Promise<WheelPlan> }>();

export function fetchWheelPlan(ticker: string, symbol: string): Promise<WheelPlan> {
  const hit = inflight.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;

  const plan = buildPlan(ticker, symbol);
  inflight.set(symbol, { at: Date.now(), plan });
  plan.catch(() => inflight.delete(symbol));
  return plan;
}

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
