import type { NextRequest } from "next/server";
import { synthesizeVerdict } from "../../../lib/gemini/synth";
import { getPriceAction, getTechnicalIndicators } from "../../../lib/moomoo/sidecar";
import { fetchWheelPlan } from "../../../lib/wheel/plan";
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
    wheel: PanelSummary;
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
    // Fetched server-side (deterministic, not client-provided) so the breakdown
    // guard can't be bypassed. None throws — null degrades gracefully.
    const [priceAction, technicalIndicators, wheelPlan] = await Promise.all([
      getPriceAction(body.symbol),
      getTechnicalIndicators(body.symbol),
      fetchWheelPlan(body.ticker, body.symbol).catch(() => null),
    ]);
    const verdict = await synthesizeVerdict({
      ticker: body.ticker,
      symbol: body.symbol,
      snapshot: body.snapshot ?? null,
      priceAction,
      technicalIndicators,
      wheelPlan,
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
