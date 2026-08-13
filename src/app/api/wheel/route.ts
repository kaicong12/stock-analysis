// GET /api/wheel — the deterministic wheel plan for one underlying.

import { normalizeSymbol, ticker as toTicker } from "@/lib/symbol";
import { fetchWheelPlan } from "@/lib/wheel/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Returns the vol regime, acquisition zone and scored strike tables for a symbol. */
export async function GET(req: Request) {
  const rawSymbol = new URL(req.url).searchParams.get("symbol")?.trim();
  if (!rawSymbol) {
    return Response.json({ error: "symbol query param is required" }, { status: 400 });
  }
  let symbol: string;
  try {
    symbol = normalizeSymbol(rawSymbol);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    const plan = await fetchWheelPlan(toTicker(symbol), symbol);
    return Response.json({ plan });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[wheel] failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }
}
