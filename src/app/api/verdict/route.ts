import type { NextRequest } from "next/server";
import { synthesizeVerdict } from "../../../lib/gemini/synth";
import { getPriceAction, getTechnicalIndicators } from "../../../lib/moomoo/sidecar";
import type {
  HeldGroup,
  PanelSummary,
  Portfolio,
  Position,
  SnapshotResult,
} from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface VerdictBody {
  ticker?: string;
  symbol?: string;
  snapshot?: SnapshotResult | null;
  portfolio?: Portfolio | null;
  heldPositions?: Position[];
  heldGroups?: HeldGroup[];
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
    // Price-action signal + standing technical indicators are fetched
    // server-side (deterministic data, not client-provided) so the falling-knife
    // guard can't be bypassed by the client and the figures are trustworthy.
    // Neither throws — null degrades gracefully (guard no-ops / overlay ignored).
    const [priceAction, technicalIndicators] = await Promise.all([
      getPriceAction(body.symbol),
      getTechnicalIndicators(body.symbol),
    ]);
    const verdict = await synthesizeVerdict({
      ticker: body.ticker,
      symbol: body.symbol,
      snapshot: body.snapshot ?? null,
      portfolio: body.portfolio ?? null,
      heldPositions: body.heldPositions ?? [],
      heldGroups: body.heldGroups ?? [],
      priceAction,
      technicalIndicators,
      panels: body.panels,
    });
    return Response.json({ verdict });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[verdict] failed:`, msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
