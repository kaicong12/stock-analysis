import { findHeldPositions, getPortfolio } from "../ibkr/client";
import { enrichWithLiveGreeks } from "../moomoo/options";
import { enrichOptionExpiries } from "./enrich";
import { classifyPortfolio } from "./groups";
import { annotateGroups } from "./triggers";
import type { HeldGroup, Portfolio, Position } from "../types";

export interface SharedPortfolio {
  portfolio: Portfolio | null;
  groups: HeldGroup[];
  errors: { source: string; message: string }[];
}

export async function prepareSharedPortfolio(): Promise<SharedPortfolio> {
  const errors: { source: string; message: string }[] = [];
  let portfolio: Portfolio | null = null;
  try {
    portfolio = await getPortfolio();
  } catch (e) {
    errors.push({ source: "portfolio", message: (e as Error).message });
  }
  if (portfolio) {
    try {
      portfolio = { ...portfolio, positions: await enrichOptionExpiries(portfolio.positions) };
    } catch (e) {
      errors.push({ source: "held-expiry", message: (e as Error).message });
    }
  }
  const cashForCsp = (portfolio?.summary.totalCash ?? 0) + (portfolio?.summary.availableFunds ?? 0);
  const groups = classifyPortfolio(portfolio?.positions ?? [], { cashAvailableForCsp: cashForCsp });
  annotateGroups(groups);
  return { portfolio, groups, errors };
}

export interface TickerSubset {
  heldPositions: Position[];
  heldGroups: HeldGroup[];
  errors: { source: string; message: string }[];
}

// Live-Greeks-enrich the legs we hold for one ticker, then splice them back
// into the shared groups so downstream consumers see real Δ/Θ/V/IV on the
// ticker's legs without rebuilding the whole portfolio classification.
export async function prepareTickerSubset(
  shared: SharedPortfolio,
  ticker: string,
): Promise<TickerSubset> {
  const errors: { source: string; message: string }[] = [];
  const rawHeld = findHeldPositions(shared.portfolio, ticker);
  let heldPositions = rawHeld;
  try {
    heldPositions = await enrichWithLiveGreeks(rawHeld);
  } catch (e) {
    errors.push({ source: "held-greeks", message: (e as Error).message });
  }
  const enrichedById = new Map(heldPositions.map((p) => [p.conid, p]));
  const heldGroups: HeldGroup[] = shared.groups.map((g) => ({
    ...g,
    legs: g.legs.map((p) => enrichedById.get(p.conid) ?? p),
  }));
  return { heldPositions, heldGroups, errors };
}
