import type { NextRequest } from "next/server";
import { computeExpectedMove, synthesizeVerdict } from "../../../lib/gemini/synth";
import { getPriceAction, getTechnicalIndicators, getVolSummary } from "../../../lib/moomoo/sidecar";
import type { PanelSummary, SnapshotResult } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface VerdictBody {
  ticker?: string;
  symbol?: string;
  snapshot?: SnapshotResult | null;
  macroContext?: string | null;
  panels?: {
    capital: PanelSummary;
    technical: PanelSummary;
    derivatives: PanelSummary;
    news: PanelSummary;
    digest: PanelSummary;
    sentiment: PanelSummary;
    fundamentals: PanelSummary;
    insider: PanelSummary;
  };
}

export async function POST(request: NextRequest) {
  let body: VerdictBody;
  try {
    body = (await request.json()) as VerdictBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.ticker || !body.symbol || !body.panels) {
    return Response.json({ error: "ticker, symbol, and panels are required" }, { status: 400 });
  }
  try {
    // Price-action signal, standing technical indicators, and the vol snapshot
    // are fetched server-side (deterministic data, not client-provided) so the
    // falling-knife guard can't be bypassed and the figures are trustworthy.
    // None throws — null degrades gracefully (guard no-ops / overlay ignored).
    const [priceAction, technicalIndicators, volSummary] = await Promise.all([
      getPriceAction(body.symbol),
      getTechnicalIndicators(body.symbol),
      getVolSummary(body.symbol),
    ]);
    const verdict = await synthesizeVerdict({
      ticker: body.ticker,
      symbol: body.symbol,
      snapshot: body.snapshot ?? null,
      priceAction,
      technicalIndicators,
      // 1-SD expected move from ATM IV — feeds the strike-placement check.
      expectedMove: computeExpectedMove(volSummary),
      // Raw IV/HV — feeds the deterministic IV-HV discount guard.
      ivHvRatio: volSummary?.ivHvRatio ?? null,
      macroContext: body.macroContext ?? null,
      panels: body.panels,
    });
    return Response.json({ verdict });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[verdict] failed:`, msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
