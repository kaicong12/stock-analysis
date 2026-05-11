import type { NextRequest } from "next/server";
import {
  analyzeCapital,
  analyzeDerivatives,
  analyzeDigest,
  analyzeFundamentals,
  analyzeNews,
  analyzeSentiment,
  analyzeTechnical,
} from "../../../../lib/gemini/panels";
import { getStockFeed, newsForDigest, searchNews } from "../../../../lib/moomoo/httpApi";
import { getAnomaly, getFundamentals } from "../../../../lib/moomoo/sidecar";
import { normalizeSymbol, ticker as toTicker } from "../../../../lib/symbol";
import type { PanelSummary } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One LLM call + one upstream data fetch. 60s headroom for the slowest model.
export const maxDuration = 60;

const PANEL_NAMES = [
  "capital",
  "technical",
  "derivatives",
  "news",
  "digest",
  "sentiment",
  "fundamentals",
] as const;
type PanelName = (typeof PANEL_NAMES)[number];

interface PanelBody {
  ticker?: string;
}

function panelError(headline: string, message: string): PanelSummary {
  return {
    headline,
    bullets: [],
    direction: "n/a",
    conclusion: `Skill failed: ${message}`,
  };
}

async function runPanel(name: PanelName, ticker: string, symbol: string): Promise<PanelSummary> {
  const ctx = { ticker, symbol };
  switch (name) {
    case "capital": {
      const data = await getAnomaly("capital", symbol);
      return analyzeCapital(data, ctx);
    }
    case "technical": {
      const data = await getAnomaly("technical", symbol);
      return analyzeTechnical(data, ctx);
    }
    case "derivatives": {
      const data = await getAnomaly("derivatives", symbol);
      return analyzeDerivatives(data, ctx);
    }
    case "news": {
      const data = await searchNews(ticker);
      return analyzeNews(data, ctx);
    }
    case "digest": {
      const data = await newsForDigest(ticker);
      return analyzeDigest(data, ctx);
    }
    case "sentiment": {
      const data = await getStockFeed(ticker);
      return analyzeSentiment(data, ctx);
    }
    case "fundamentals": {
      const data = await getFundamentals(symbol);
      return analyzeFundamentals(data, ctx);
    }
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!(PANEL_NAMES as readonly string[]).includes(name)) {
    return Response.json({ error: `unknown panel '${name}'` }, { status: 404 });
  }
  let body: PanelBody;
  try {
    body = (await request.json()) as PanelBody;
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

  try {
    const summary = await runPanel(name as PanelName, tk, symbol);
    return Response.json({ name, summary });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[panel:${name}] failed:`, msg);
    return Response.json({
      name,
      summary: panelError(`${name} panel unavailable.`, msg),
      error: msg,
    });
  }
}
