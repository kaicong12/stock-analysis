// Headline sourcing for the digest: keyword fan-out, dedup, and citation mapping. No LLM.

import { searchNews } from "../moomoo/httpApi";
import { relAge } from "../gemini/panels/_shared";
import type { DigestCitation, PooledHeadline } from "./types";

// Broad keywords ("stock market") return single-name HK movers, not market news. Keep these narrow.
export const STANDING_KEYWORDS = {
  movers: ["S&P 500", "Federal Reserve", "inflation CPI", "Treasury yields", "Nasdaq tech stocks"],
  vol: ["VIX volatility", "market volatility", "options market"],
  runway: ["economic calendar", "CPI report", "jobs report", "earnings season"],
} as const;

// Three days, not one, so a Monday run still sees Friday's tape.
export const MAX_AGE_HOURS = 72;

const PER_KEYWORD = 8;
const MAX_PER_SECTION = 28;
const MAX_CITATIONS = 4;
const MAX_SCOUT_KEYWORDS = 3;
const MAX_KEYWORD_WORDS = 5;

const BANNED_KEYWORDS = new Set([
  "stock market", "stocks", "stock", "markets", "market", "economy", "news",
  "finance", "financial news", "trading", "investing", "wall street",
]);

const STANDING_LOWER = new Set(
  Object.values(STANDING_KEYWORDS).flat().map((k) => k.toLowerCase()),
);

/** Merges keyword result lists round-robin, deduped by id, so no keyword's tail starves another's head. */
export function interleaveDedup(lists: PooledHeadline[][], max: number): PooledHeadline[] {
  const seen = new Set<string>();
  const out: PooledHeadline[] = [];
  const depth = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let d = 0; d < depth && out.length < max; d++) {
    for (const list of lists) {
      if (out.length >= max) break;
      const item = list[d];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Drops headlines older than the window, and undated ones. */
export function withinAge(
  items: PooledHeadline[],
  nowMs: number,
  maxAgeHours = MAX_AGE_HOURS,
): PooledHeadline[] {
  const floor = nowMs - maxAgeHours * 3600_000;
  return items.filter((i) => i.publishTime > 0 && i.publishTime * 1000 >= floor);
}

/** Fetches one searchNews per keyword and merges them; a failed keyword is skipped, never fatal. */
export async function collate(
  keywords: readonly string[],
  nowMs: number,
  max = MAX_PER_SECTION,
): Promise<PooledHeadline[]> {
  const results = await Promise.allSettled(keywords.map((k) => searchNews(k, PER_KEYWORD)));
  const lists = results.map((res, i) =>
    res.status !== "fulfilled"
      ? []
      : res.value.items.map((it) => ({
          id: it.id,
          title: it.title,
          url: it.url,
          publishTime: it.publishTime,
          keyword: keywords[i],
        })),
  );
  return withinAge(interleaveDedup(lists, max), nowMs);
}

/** Filters the scout's keywords, rejecting broad or already-covered ones in code rather than by prompt. */
export function sanitizeScoutKeywords(
  raw: string[] | undefined,
  max = MAX_SCOUT_KEYWORDS,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of raw ?? []) {
    if (typeof k !== "string") continue;
    const t = k.trim().replace(/\s+/g, " ");
    const lc = t.toLowerCase();
    if (t.length < 3 || t.length > 60) continue;
    if (t.split(" ").length > MAX_KEYWORD_WORDS) continue;
    if (BANNED_KEYWORDS.has(lc) || STANDING_LOWER.has(lc) || seen.has(lc)) continue;
    seen.add(lc);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Renders the pool as a numbered list, carrying no URLs so an agent cites by index. */
export function formatPool(pool: PooledHeadline[], nowMs: number): string {
  if (!pool.length) return "(no headlines in the window)";
  return pool
    .map((h, i) => `[${i + 1}] ${relAge(h.publishTime, nowMs)} — ${h.title}`)
    .join("\n");
}

/** Maps an agent's 1-based indexes back to real headlines, dropping invalid and duplicate picks. */
export function resolveCitations(
  pool: PooledHeadline[],
  cites: number[] | undefined,
  max = MAX_CITATIONS,
): DigestCitation[] {
  const out: DigestCitation[] = [];
  const seen = new Set<number>();
  for (const n of cites ?? []) {
    if (!Number.isInteger(n) || n < 1 || n > pool.length || seen.has(n)) continue;
    seen.add(n);
    const h = pool[n - 1];
    out.push({
      title: h.title,
      url: h.url,
      publishedAt: new Date(h.publishTime * 1000).toISOString(),
    });
    if (out.length >= max) break;
  }
  return out;
}
