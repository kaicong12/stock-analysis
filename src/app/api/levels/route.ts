import { computeExpectedMove } from "@/lib/gemini/synth";
import { getTechnicalIndicators, getVolSummary } from "@/lib/moomoo/sidecar";
import { normalizeSymbol, ticker as bareTicker } from "@/lib/symbol";
import type { LevelsSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live levels for one underlying: the 1-SD expected move (recomputed from the
// current vol snapshot) plus swing support/resistance. The held-options panels
// compare these MOVING bounds against a position's FIXED short strike to flag a
// breach. Pure data — the breach interpretation lives in the component.
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

// Single-symbol read — used by the focused Held-Options detail card.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const rawSymbol = params.get("symbol")?.trim();
  if (!rawSymbol) {
    return Response.json({ error: "symbol query param is required" }, { status: 400 });
  }
  const snapshot = await computeLevels(rawSymbol, Number(params.get("dte")));
  return Response.json({ snapshot });
}

interface BatchItem {
  symbol: string;
  dte?: number;
}

// Batch read for the rail Options panel — one round-trip for the whole book.
// Body: { items: [{ symbol, dte }] }. Returns snapshots keyed by BARE ticker
// (e.g. "QQQ") so the rail can look up by HeldGroup.underlying. A single failed
// symbol maps to null rather than failing the batch.
export async function POST(req: Request) {
  let items: BatchItem[];
  try {
    const body = (await req.json()) as { items?: BatchItem[] };
    items = Array.isArray(body.items) ? body.items : [];
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // De-dupe by bare ticker so two legs on the same name don't double-fetch.
  const byTicker = new Map<string, BatchItem>();
  for (const it of items) {
    if (!it?.symbol) continue;
    byTicker.set(bareTicker(normalizeSymbol(it.symbol)), it);
  }
  // Bound concurrency: each computeLevels hits the heavy OpenD /options/vol-summary,
  // which moomoo rate-limits. Firing all names at once made atmIv come back null
  // (→ expected move "n/a"), so we process in small waves instead.
  const snapshots: Record<string, LevelsSnapshot | null> = {};
  const queue = [...byTicker.entries()];
  const CONCURRENCY = 3;
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [key, it] = next;
      try {
        snapshots[key] = await computeLevels(it.symbol, Number(it.dte));
      } catch {
        snapshots[key] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return Response.json({ snapshots });
}
