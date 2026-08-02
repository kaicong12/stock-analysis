import type { NextRequest } from "next/server";
import { getFundamentals, getSnapshot } from "../../../lib/moomoo/sidecar";
import { normalizeSymbol, ticker as toTicker } from "../../../lib/symbol";
import { daysUntilISO } from "../../../lib/date";
import type { SnapshotResult } from "../../../lib/types";

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
  errors: { source: string; message: string }[];
  // Cheap earnings pre-flight (yfinance, no Gemini) so the UI can warn BEFORE
  // spending the panel calls. null when unavailable — the gate just won't fire.
  nextEarningsDate: string | null;
  earningsDaysAway: number | null;
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

  // Earnings pre-flight: cheap yfinance read (no Gemini). A failure here must
  // never block prep — fall back to null so the gate simply doesn't fire.
  let nextEarningsDate: string | null = null;
  try {
    const fundamentals = await getFundamentals(symbol);
    nextEarningsDate = fundamentals.data?.nextEarningsDate ?? null;
  } catch (e) {
    console.error("[prep] earnings pre-flight failed:", (e as Error).message);
  }

  const payload: PrepResponse = {
    ticker: tk,
    symbol,
    snapshot,
    errors: [],
    nextEarningsDate,
    earningsDaysAway: daysUntilISO(nextEarningsDate),
  };
  return Response.json(payload);
}
