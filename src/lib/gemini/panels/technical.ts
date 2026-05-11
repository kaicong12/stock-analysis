// Technical-analysis panel. Prompt mirrors the moomoo-technical-anomaly skill;
// body lives in src/lib/gemini/panels/prompts/technical.ts.

import { genJson } from "../client";
import type { AnomalyResult, PanelSummary } from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/technical";

const SCHEMA = baseSchema();

export async function analyzeTechnical(
  input: AnomalyResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || !input.content?.trim()) return emptyPanel("No technical-indicator data.");
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Window: last ${input.timeRange} days.`,
    "",
    "moomoo technical anomaly report:",
    "```",
    input.content.trim(),
    "```",
    "",
    "Produce the panel JSON.",
  ].join("\n");
  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
