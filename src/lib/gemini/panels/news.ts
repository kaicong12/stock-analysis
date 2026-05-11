// News panel. Prompt mirrors the moomoo-news-search skill;
// body lives in src/lib/gemini/panels/prompts/news.ts.

import { genJson } from "../client";
import type { NewsResult, PanelSummary } from "../../types";
import {
  EVIDENCE_PROP,
  baseSchema,
  compressNews,
  emptyEvidencePanel,
  type PanelContext,
} from "./_shared";
import { SYSTEM } from "./prompts/news";

const SCHEMA = baseSchema(EVIDENCE_PROP, ["evidence"]);

export async function analyzeNews(
  input: NewsResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || input.items.length === 0) return emptyEvidencePanel("No recent news.");
  const items = compressNews(input, 12, Date.now());
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}).`,
    "",
    "Recent news items (most recent first):",
    "```json",
    JSON.stringify(items, null, 2),
    "```",
    "",
    "Produce the news panel JSON. Preserve titles and urls EXACTLY from above in evidence[].",
  ].join("\n");
  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
