// Capital-flow panel. Prompt mirrors the moomoo-capital-anomaly skill verbatim;
// kept in src/lib/gemini/panels/prompts/capital.ts so the prompt body is editable
// independently and stays in sync with ~/.claude/skills/moomoo-capital-anomaly/SKILL.md.

import { genJson } from "../client";
import type { AnomalyResult, PanelSummary } from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/capital";

const SCHEMA = baseSchema();

// Format a Date as moomoo's "YYYY.M.D" window style (no zero-padding), to match
// the 时间范围 line the skill emits.
function fmtWindowDate(d: Date): string {
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// Resolve the concrete calendar window for the report. The model must NOT invent
// these dates (it has no reliable notion of "today"), and moomoo's own time_range
// is a RELATIVE phrase ("近30个自然日"), not a date range — so we always derive
// [today - timeRange days, today] from the real current date here.
function resolveWindow(timeRange: number): string {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - timeRange);
  return `${fmtWindowDate(start)} - ${fmtWindowDate(end)}`;
}

// moomoo embeds per-anomaly dates as raw unix-epoch markers ("[timestamp: 1781496000]").
// Convert them to ISO dates so the model surfaces correct dates instead of doing
// (often wrong) epoch→calendar math itself — the original source of phantom windows.
function humanizeTimestamps(content: string): string {
  return content.replace(/\[timestamp:\s*(\d+)\]/g, (full, secs: string) => {
    const d = new Date(Number(secs) * 1000);
    return Number.isNaN(d.getTime()) ? full : `[date: ${d.toISOString().slice(0, 10)}]`;
  });
}

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
