// Derivatives panel. Prompt mirrors the moomoo-derivatives-anomaly skill;
// body lives in src/lib/gemini/panels/prompts/derivatives.ts.

import { genJson } from "../client";
import type { AnomalyResult, PanelSummary } from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/derivatives";

const SCHEMA = baseSchema();

export async function analyzeDerivatives(
  input: AnomalyResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || !input.content?.trim()) return emptyPanel("No derivatives data.");
  const isHk = ctx.symbol.startsWith("HK.");
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Window: last ${input.timeRange} days. HK-listed: ${isHk}.`,
    "",
    "moomoo derivatives anomaly report:",
    "```",
    input.content.trim(),
    "```",
    "",
    isHk ? "" : "Note: not HK-listed; ignore CBBC/warrant blocks if present.",
    "Produce the panel JSON.",
  ]
    .filter(Boolean)
    .join("\n");
  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
