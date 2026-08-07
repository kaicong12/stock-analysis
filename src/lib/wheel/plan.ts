import {
  getFundamentals,
  getPriceAction,
  getTechnicalIndicators,
  getVolRegime,
  getWheelChain,
} from "../moomoo/sidecar";
import { buildWheelPlan } from "./score";
import { computeZone } from "./zone";
import type { WheelPlan } from "./types";

// Assembles the deterministic wheel read. Every input degrades to null on
// failure, so a dead sidecar yields an empty plan rather than an exception.
export async function fetchWheelPlan(ticker: string, symbol: string): Promise<WheelPlan> {
  const [chain, regime, tech, priceAction, fundamentals] = await Promise.all([
    getWheelChain(symbol),
    getVolRegime(symbol),
    getTechnicalIndicators(symbol),
    getPriceAction(symbol),
    getFundamentals(symbol).catch(() => null),
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
    priceAction,
    nextEarningsDate: f?.nextEarningsDate ?? null,
    exDividendDate: f?.exDividendDate ?? null,
  });
}
