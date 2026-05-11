// Capital-flow panel. Prompt mirrors the moomoo-capital-anomaly skill verbatim;
// kept in src/lib/gemini/panels/prompts/capital.ts so the prompt body is editable
// independently and stays in sync with ~/.claude/skills/moomoo-capital-anomaly/SKILL.md.

import { genJson } from "../client";
import type { AnomalyResult, PanelSummary } from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/capital";

const SCHEMA = baseSchema();

export async function analyzeCapital(
  input: AnomalyResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || !input.content?.trim()) return emptyPanel("No capital-flow data.");
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Window: last ${input.timeRange} days.`,
    "",
    "moomoo capital anomaly report:",
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
