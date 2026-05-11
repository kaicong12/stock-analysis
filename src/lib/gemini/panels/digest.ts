// Digest panel. Prompt mirrors the moomoo-stock-digest skill;
// body lives in src/lib/gemini/panels/prompts/digest.ts.

import { genJson } from "../client";
import type { DigestResult, PanelSummary } from "../../types";
import {
  EVIDENCE_PROP,
  baseSchema,
  compressNews,
  emptyEvidencePanel,
  type PanelContext,
} from "./_shared";
import { SYSTEM } from "./prompts/digest";

const SCHEMA = baseSchema(EVIDENCE_PROP, ["evidence"]);

export async function analyzeDigest(
  input: DigestResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || input.items.length === 0) {
    return emptyEvidencePanel("No obvious new stock-specific factors.");
  }
  const items = compressNews(input, 15, Date.now());
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}).`,
    "",
    "Recent items for the digest:",
    "```json",
    JSON.stringify(items, null, 2),
    "```",
    "",
    "Produce the digest panel JSON. Preserve titles and urls EXACTLY from above in evidence[].",
  ].join("\n");
  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
