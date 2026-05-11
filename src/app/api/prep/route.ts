import type { NextRequest } from "next/server";
import { findHeldPositions, getPortfolio } from "../../../lib/ibkr/client";
import { enrichWithLiveGreeks } from "../../../lib/ibkr/options";
import { getSnapshot } from "../../../lib/moomoo/sidecar";
import { enrichOptionExpiries } from "../../../lib/positions/enrich";
import { classifyPortfolio } from "../../../lib/positions/groups";
import { annotateGroups } from "../../../lib/positions/triggers";
import { normalizeSymbol, ticker as toTicker } from "../../../lib/symbol";
import type { HeldGroup, Portfolio, Position, SnapshotResult } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PrepBody {
  ticker?: string;
}

interface PrepResponse {
  ticker: string;
  symbol: string;
  snapshot: SnapshotResult;
  portfolio: Portfolio | null;
  heldPositions: Position[];
  heldGroups: HeldGroup[];
  errors: { source: string; message: string }[];
}

export async function POST(request: NextRequest) {
  let body: PrepBody;
  try {
    body = (await request.json()) as PrepBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const rawTicker = (body.ticker ?? "").trim();
  if (!rawTicker) return Response.json({ error: "ticker is required" }, { status: 400 });

  let symbol: string;
  try {
    symbol = normalizeSymbol(rawTicker);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const tk = toTicker(symbol);

  const errors: { source: string; message: string }[] = [];

  // Fail-fast on bad ticker — same as today's analyze route.
  let snapshot: SnapshotResult;
  try {
    snapshot = await getSnapshot(symbol);
  } catch (e) {
    return Response.json(
      {
        error: `Ticker "${tk}" was not recognized by moomoo. Try a US ticker (e.g. AAPL), or prefix with a market (HK.00700, SH.600519, SZ.000001, SG.D05).`,
        code: "TICKER_NOT_FOUND",
        symbol,
        detail: (e as Error).message,
      },
      { status: 404 },
    );
  }

  let portfolio: Portfolio | null = null;
  try {
    portfolio = await getPortfolio();
  } catch (e) {
    errors.push({ source: "portfolio", message: (e as Error).message });
  }

  // Resolve real maturities for OPT positions before classification — the
  // contractDesc fallback in adaptPosition assumes monthly third-Friday
  // expiries, which is wrong for weeklies (Jun05/Jun12 vs Jun19) and would
  // contaminate every downstream HeldGroup.expiry / dte / dteUnder21 read.
  if (portfolio) {
    try {
      portfolio = { ...portfolio, positions: await enrichOptionExpiries(portfolio.positions) };
    } catch (e) {
      errors.push({ source: "held-expiry", message: (e as Error).message });
    }
  }

  const rawHeld = findHeldPositions(portfolio, tk);
  let heldPositions = rawHeld;
  try {
    heldPositions = await enrichWithLiveGreeks(rawHeld);
  } catch (e) {
    errors.push({ source: "held-greeks", message: (e as Error).message });
  }

  // Auto-detect groups across the WHOLE portfolio (rail uses all of them; detail
  // card filters by ticker downstream). cashForCsp = totalCash + availableFunds
  // is already in the user's base currency.
  const cash = (portfolio?.summary.totalCash ?? 0) + (portfolio?.summary.availableFunds ?? 0);
  const heldGroups = classifyPortfolio(portfolio?.positions ?? [], { cashAvailableForCsp: cash });
  annotateGroups(heldGroups);

  // Splice in the live-Greeks-enriched legs for the searched ticker so the
  // detail card sees real Δ/Θ/V/IV without a second IBKR snapshot call.
  if (heldPositions.length > 0) {
    const enrichedById = new Map(heldPositions.map((p) => [p.conid, p]));
    for (const g of heldGroups) {
      g.legs = g.legs.map((p) => enrichedById.get(p.conid) ?? p);
    }
  }

  const payload: PrepResponse = {
    ticker: tk,
    symbol,
    snapshot,
    portfolio,
    heldPositions,
    heldGroups,
    errors,
  };
  return Response.json(payload);
}
