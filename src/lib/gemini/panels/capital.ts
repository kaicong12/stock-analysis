// Capital-flow panel over the moomoo capital anomaly report.

import { genJson } from "../client";
import type { AnomalyResult, PanelSummary } from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/capital";

const SCHEMA = baseSchema();

// Formats a Date in moomoo's unpadded "YYYY.M.D" window style.
function fmtWindowDate(d: Date): string {
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// Derives the concrete calendar window for the report, since moomoo's time_range is a relative phrase.
function resolveWindow(timeRange: number): string {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - timeRange);
  return `${fmtWindowDate(start)} - ${fmtWindowDate(end)}`;
}

// Rewrites moomoo's raw epoch markers as ISO dates so the model never does epoch math.
function humanizeTimestamps(content: string): string {
  return content.replace(/\[timestamp:\s*(\d+)\]/g, (full, secs: string) => {
    const d = new Date(Number(secs) * 1000);
    return Number.isNaN(d.getTime()) ? full : `[date: ${d.toISOString().slice(0, 10)}]`;
  });
}

/** Produces the capital-flow panel from the anomaly report. */
export async function analyzeCapital(
  input: AnomalyResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || !input.content?.trim()) return emptyPanel("No capital-flow data.");
  const window = resolveWindow(input.timeRange);
  const report = humanizeTimestamps(input.content.trim());
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Window: ${window} (last ${input.timeRange} days).`,
    `Use this exact window string for the 时间范围 / "Window:" line — do NOT compute or invent your own dates. Per-anomaly dates are pre-converted to ISO ([date: YYYY-MM-DD]); cite them verbatim.`,
    "",
    "moomoo capital anomaly report:",
    "```",
    report,
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
