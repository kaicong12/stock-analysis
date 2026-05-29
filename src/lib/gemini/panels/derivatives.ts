// Derivatives panel. Prompt mirrors the moomoo-derivatives-anomaly skill;
// body lives in src/lib/gemini/panels/prompts/derivatives.ts.

import { genJson } from "../client";
import type { AnomalyResult, PanelSummary, VolSummary } from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/derivatives";

const SCHEMA = baseSchema();

// Build the deterministic structured-vol block that gets embedded in the
// prompt. The panel prompt requires the model to cite these numbers verbatim
// rather than inferring IV/HV/skew from the anomaly report.
function volBlock(v: VolSummary): string {
  const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const num = (x: number | null, d = 2): string => (x === null ? "n/a" : x.toFixed(d));
  return [
    `Structured vol snapshot (server-computed; cite VERBATIM, do not infer):`,
    `  spot: $${v.spot.toFixed(2)}`,
    `  expiry sampled: ${v.expiryUsed} (${v.dte} DTE)`,
    `  ATM IV (avg call+put): ${pct(v.atmIv)}`,
    `    call ATM IV @ strike $${num(v.atmStrikeCall)}: ${pct(v.atmIvCall)}`,
    `    put ATM IV  @ strike $${num(v.atmStrikePut)}: ${pct(v.atmIvPut)}`,
    `  HV30 (30 trading-day, sqrt(252)-annualized): ${pct(v.hv30)}  [${v.hvSampleSize} daily returns]`,
    `  HV60: ${pct(v.hv60)}`,
    `  IV/HV ratio (atmIv/hv30): ${num(v.ivHvRatio)}`,
    `  25Δ skew (put IV @ Δ≈-0.25 minus call IV @ Δ≈+0.25): ${pct(v.skew25d)}`,
    `    put strike $${num(v.skew25dPutStrike)} vs call strike $${num(v.skew25dCallStrike)}`,
  ].join("\n");
}

export async function analyzeDerivatives(
  input: AnomalyResult | null,
  ctx: PanelContext,
  vol: VolSummary | null,
): Promise<PanelSummary> {
  // Either source carries this panel. If both are absent there's nothing to analyze.
  const hasAnomaly = !!input?.content?.trim();
  if (!hasAnomaly && !vol) return emptyPanel("No derivatives data.");

  const isHk = ctx.symbol.startsWith("HK.");
  const sections: string[] = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Window: last ${input?.timeRange ?? 30} days. HK-listed: ${isHk}.`,
    "",
  ];

  if (vol) {
    sections.push(volBlock(vol), "");
  } else {
    sections.push("Structured vol snapshot: unavailable (sidecar /options/vol-summary failed).", "");
  }

  if (hasAnomaly) {
    sections.push("moomoo derivatives anomaly report:", "```", input!.content.trim(), "```", "");
  } else {
    sections.push("moomoo derivatives anomaly report: unavailable.", "");
  }

  if (!isHk) sections.push("Note: not HK-listed; ignore CBBC/warrant blocks if present.");
  sections.push("Produce the panel JSON.");

  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt: sections.join("\n"),
    temperature: 0.3,
  });
}
