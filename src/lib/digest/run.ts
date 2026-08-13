// Orchestrates one digest cycle and caches it process-wide.

import { getMarketTape } from "../moomoo/sidecar";
import { fetchFomcDates } from "../wheel/fomc";
import { quietSection, runEditor, runScout, runSection, unavailableSection } from "./agents";
import { STANDING_KEYWORDS, collate, interleaveDedup } from "./sources";
import type { DigestSection, DigestSectionKey, MarketDigestResult, MarketTape } from "./types";

// Shorter than the macro briefing's 6h because "latest news" is the point.
const TTL_MS = 20 * 60 * 1000;
const SCOUT_SEED_MAX = 24;

let cache: { result: MarketDigestResult; at: number } | null = null;
let inflight: Promise<MarketDigestResult> | null = null;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Sources, judges and edits one cycle, degrading section-by-section on failure. */
async function build(): Promise<MarketDigestResult> {
  const nowMs = Date.now();
  const errors: { source: string; message: string }[] = [];
  const record = (source: string, e: unknown) => {
    errors.push({ source, message: message(e) });
  };

  const [tape, moversPool, volPool, runwayPool, fomcDates] = await Promise.all([
    getMarketTape().catch((e): MarketTape | null => {
      record("tape", e);
      return null;
    }),
    collate(STANDING_KEYWORDS.movers, nowMs),
    collate(STANDING_KEYWORDS.vol, nowMs),
    collate(STANDING_KEYWORDS.runway, nowMs),
    fetchFomcDates(),
  ]);

  const input = { tape, fomcDates, nowMs };

  const settle = async (
    key: DigestSectionKey,
    work: () => Promise<DigestSection>,
  ): Promise<DigestSection> => {
    try {
      return await work();
    } catch (e) {
      record(key, e);
      return unavailableSection(key, message(e));
    }
  };

  // Runs alongside the standing sections rather than behind a barrier — only risk depends on the scout.
  const riskChain = (async (): Promise<{ section: DigestSection; keywords: string[] }> => {
    try {
      const seed = interleaveDedup([moversPool, volPool, runwayPool], SCOUT_SEED_MAX);
      const keywords = await runScout(seed, nowMs);
      if (!keywords.length) {
        const note = "Nothing beyond the standing beats surfaced this cycle.";
        return { section: quietSection("risk", note), keywords };
      }
      const pool = await collate(keywords, nowMs);
      return { section: await runSection("risk", pool, input), keywords };
    } catch (e) {
      record("risk", e);
      return { section: unavailableSection("risk", message(e)), keywords: [] };
    }
  })();

  const [movers, vol, runway, risk] = await Promise.all([
    settle("movers", () => runSection("movers", moversPool, input)),
    settle("vol", () => runSection("vol", volPool, input)),
    settle("runway", () => runSection("runway", runwayPool, input)),
    riskChain,
  ]);

  const sections = [movers, vol, runway, risk.section];

  let topLine: string | null = null;
  try {
    topLine = await runEditor(sections, tape);
  } catch (e) {
    record("editor", e);
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    asOf: tape?.asOf ?? null,
    topLine,
    tape,
    sections,
    scoutKeywords: risk.keywords,
    errors: [...errors, ...(tape?.errors ?? [])],
  };
}

/** Returns the cached digest, sharing one in-flight build across callers and never caching a total failure. */
export async function fetchMarketDigest(): Promise<MarketDigestResult> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.result;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const result = await build();
      if (result.sections.some((s) => s.status === "ready")) {
        cache = { result, at: Date.now() };
      }
      return result;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
