// The digest's LLM calls: one agent per section, plus the scout and the editor.

import { genJson } from "../gemini/client";
import { formatFomc, formatSectionsForEditor, formatTape } from "./format";
import { formatPool, resolveCitations, sanitizeScoutKeywords } from "./sources";
import {
  EDITOR_SYSTEM,
  MOVERS_SYSTEM,
  RISK_SYSTEM,
  RUNWAY_SYSTEM,
  SCOUT_SYSTEM,
  VOL_SYSTEM,
} from "./prompts";
import type { DigestSection, DigestSectionKey, MarketTape, PooledHeadline } from "./types";

// cites are 1-based indexes into the numbered HEADLINES block, never URLs.
const SECTION_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    cites: { type: "array", items: { type: "integer" } },
  },
  required: ["headline", "bullets", "cites"],
};

const SCOUT_SCHEMA = {
  type: "object",
  properties: { keywords: { type: "array", items: { type: "string" } } },
  required: ["keywords"],
};

const EDITOR_SCHEMA = {
  type: "object",
  properties: { topLine: { type: "string" } },
  required: ["topLine"],
};

const SECTION_TIMEOUT_MS = 60_000;
const SCOUT_TIMEOUT_MS = 30_000;
const EDITOR_TIMEOUT_MS = 45_000;

const SECTION_SYSTEMS: Record<DigestSectionKey, string> = {
  movers: MOVERS_SYSTEM,
  vol: VOL_SYSTEM,
  runway: RUNWAY_SYSTEM,
  risk: RISK_SYSTEM,
};

export interface SectionInput {
  tape: MarketTape | null;
  fomcDates: string[];
  nowMs: number;
}

/** Builds a placeholder section for one that errored. */
export function unavailableSection(key: DigestSectionKey, reason: string): DigestSection {
  return { key, headline: "Unavailable.", bullets: [reason], citations: [], status: "unavailable" };
}

/** Builds a section reporting that there was genuinely nothing to report. */
export function quietSection(key: DigestSectionKey, note: string): DigestSection {
  return { key, headline: note, bullets: [], citations: [], status: "ready" };
}

/** Runs one section agent over its own headline pool and resolves its citations. */
export async function runSection(
  key: DigestSectionKey,
  pool: PooledHeadline[],
  input: SectionInput,
): Promise<DigestSection> {
  const blocks = [`TAPE\n${formatTape(input.tape)}`];
  if (key === "runway") blocks.push(`FOMC DATES\n${formatFomc(input.fomcDates)}`);
  blocks.push(`HEADLINES\n${formatPool(pool, input.nowMs)}`);

  const out = await genJson<{ headline?: string; bullets?: string[]; cites?: number[] }>({
    systemInstruction: SECTION_SYSTEMS[key],
    prompt: blocks.join("\n\n"),
    schema: SECTION_SCHEMA,
    timeoutMs: SECTION_TIMEOUT_MS,
  });

  return {
    key,
    headline: out.headline?.trim() || "No read available.",
    bullets: (out.bullets ?? [])
      .filter((b): b is string => typeof b === "string")
      .map((b) => b.trim())
      .filter(Boolean),
    citations: resolveCitations(pool, out.cites),
    status: "ready",
  };
}

/** Picks search keywords for market stories the standing beats don't cover. */
export async function runScout(pool: PooledHeadline[], nowMs: number): Promise<string[]> {
  if (!pool.length) return [];
  const out = await genJson<{ keywords?: string[] }>({
    systemInstruction: SCOUT_SYSTEM,
    prompt: `HEADLINES ALREADY COLLECTED FOR THE STANDING BEATS\n${formatPool(pool, nowMs)}`,
    schema: SCOUT_SCHEMA,
    timeoutMs: SCOUT_TIMEOUT_MS,
  });
  return sanitizeScoutKeywords(out.keywords);
}

/** Writes the one-sentence top line over the finished sections. */
export async function runEditor(
  sections: DigestSection[],
  tape: MarketTape | null,
): Promise<string | null> {
  const ready = sections.filter((s) => s.status === "ready");
  if (!ready.length) return null;

  const out = await genJson<{ topLine?: string }>({
    systemInstruction: EDITOR_SYSTEM,
    prompt: `TAPE\n${formatTape(tape)}\n\nSECTIONS\n${formatSectionsForEditor(ready)}`,
    schema: EDITOR_SCHEMA,
    timeoutMs: EDITOR_TIMEOUT_MS,
  });
  return out.topLine?.trim() || null;
}
