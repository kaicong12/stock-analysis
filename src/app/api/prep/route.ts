import type { NextRequest } from "next/server";
import { getSnapshot } from "../../../lib/moomoo/sidecar";
import { prepareSharedPortfolio, prepareTickerSubset } from "../../../lib/positions/prepare";
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

  const shared = await prepareSharedPortfolio();
  const subset = await prepareTickerSubset(shared, tk);

  const payload: PrepResponse = {
    ticker: tk,
    symbol,
    snapshot,
    portfolio: shared.portfolio,
    heldPositions: subset.heldPositions,
    heldGroups: subset.heldGroups,
    errors: [...shared.errors, ...subset.errors],
  };
  return Response.json(payload);
}
