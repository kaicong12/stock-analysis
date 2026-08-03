import { computeExpectedMove } from "@/lib/gemini/synth";
import { getTechnicalIndicators, getVolSummary } from "@/lib/moomoo/sidecar";
import { normalizeSymbol } from "@/lib/symbol";
import type { LevelsSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live levels for one underlying: the 1-SD expected move (recomputed from the
// current vol snapshot) plus swing support/resistance. The VerdictCard what-if
// calculator compares these bounds against the short strike the user is
// considering. Pure data — the interpretation lives in the component.
//
// `symbol` may be bare ("QQQ") or qualified ("US.AAPL"); it's normalized here.
// `dte` (optional) is the position's days-to-expiry: IV is DTE-SPECIFIC (every
// expiry has its own ATM IV), so we sample vol at the expiry closest to the
// position's DTE rather than the generic 30-day default — otherwise a 19-DTE
// spread gets a 30-DTE expected move. Falls back to 30 when absent/invalid.
async function computeLevels(rawSymbol: string, dte: number): Promise<LevelsSnapshot> {
  const symbol = normalizeSymbol(rawSymbol);
  const targetDte = Number.isFinite(dte) && dte > 0 ? Math.round(dte) : 30;
  // Both getters degrade to null on sidecar failure; the panel renders what it has.
  const [vol, tech] = await Promise.all([
    getVolSummary(symbol, targetDte),
    getTechnicalIndicators(symbol),
  ]);
  const expectedMove = computeExpectedMove(vol);
  return {
    symbol,
    spot: tech?.spot ?? expectedMove?.spot ?? null,
    asOf: tech?.asOf ?? null,
    expectedMove,
    support: tech?.support ?? null,
    resistance: tech?.resistance ?? null,
    supportLevels: tech?.supportLevels ?? [],
    resistanceLevels: tech?.resistanceLevels ?? [],
  };
}

// Single-symbol read — used by the VerdictCard what-if calculator.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const rawSymbol = params.get("symbol")?.trim();
  if (!rawSymbol) {
    return Response.json({ error: "symbol query param is required" }, { status: 400 });
  }
  const snapshot = await computeLevels(rawSymbol, Number(params.get("dte")));
  return Response.json({ snapshot });
}
