import type { NextRequest } from "next/server";
import { PANEL_KEYS, type PanelKey } from "../../../../lib/batch/protocol";
import { panelError, runPanel } from "../../../../lib/gemini/runPanel";
import { normalizeSymbol, ticker as toTicker } from "../../../../lib/symbol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PanelBody {
  ticker?: string;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!(PANEL_KEYS as readonly string[]).includes(name)) {
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
    const result = await runPanel(name as PanelKey, tk, symbol);
    return Response.json({
      name,
      summary: result.summary,
      nextEarningsDate: result.nextEarningsDate ?? null,
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[panel:${name}] failed:`, msg);
    return Response.json({
      name,
      summary: panelError(name, msg),
      error: msg,
    });
  }
}
