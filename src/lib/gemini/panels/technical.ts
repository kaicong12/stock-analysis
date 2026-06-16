// Technical-analysis panel. Prompt mirrors the moomoo-technical-anomaly skill;
// body lives in src/lib/gemini/panels/prompts/technical.ts.

import { genJson } from "../client";
import type { AnomalyResult, PanelSummary, TechnicalIndicators } from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/technical";

const SCHEMA = baseSchema();

// Build the deterministic indicator-state block embedded in the prompt. These
// are server-computed (yfinance daily OHLCV); the panel prompt requires the
// model to cite these numbers verbatim rather than inferring them from the
// anomaly text. Mirrors the derivatives panel's volBlock.
function indicatorBlock(t: TechnicalIndicators): string {
  // == null catches BOTH null and undefined: a stale sidecar (pre-regime build)
  // omits adx14/plusDi/minusDi entirely, so they arrive undefined — `=== null`
  // would let undefined through into .toFixed() and crash the panel.
  const n = (x: number | null | undefined, d = 2): string => (x == null ? "n/a" : x.toFixed(d));
  const pct = (x: number | null | undefined): string => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
  return [
    `Structured indicator snapshot (server-computed; cite VERBATIM, do not infer):`,
    `  as of ${t.asOf ?? "n/a"}, spot $${n(t.spot)} (${t.barsUsed} bars)`,
    `  RSI(14): ${n(t.rsi14, 1)} — ${t.rsiState}`,
    `  MACD: ${n(t.macd)} / signal ${n(t.macdSignal)} / hist ${n(t.macdHist)} (${(t.macdHist ?? 0) >= 0 ? "bullish" : "bearish"})`,
    `  Bollinger(20,2) %B: ${n(t.bbPctB, 3)} (>1 above upper band, <0 below lower; upper ${n(t.bbUpper)}, lower ${n(t.bbLower)})`,
    `  vs SMA20 ${pct(t.pctVsSma20)}, vs SMA50 ${pct(t.pctVsSma50)}, vs SMA200 ${pct(t.pctVsSma200)}`,
    `  52w high $${n(t.high52w)} (${pct(t.pctOff52wHigh)} off), 52w low $${n(t.low52w)}`,
    `  return 5d ${pct(t.ret5d)}, 20d ${pct(t.ret20d)}`,
    `  regime: ${t.regime ?? "n/a"} (ADX14 ${n(t.adx14, 1)}, +DI ${n(t.plusDi, 1)} / -DI ${n(t.minusDi, 1)}), RSI divergence: ${t.rsiDivergence ?? "none"}`,
    `  support ${t.support == null ? "n/a" : `$${n(t.support)}`}${t.supportLevels?.length ? ` [${t.supportLevels.map((x) => `$${x.toFixed(2)}`).join(", ")}]` : ""}, resistance ${t.resistance == null ? "n/a" : `$${n(t.resistance)}`}${t.resistanceLevels?.length ? ` [${t.resistanceLevels.map((x) => `$${x.toFixed(2)}`).join(", ")}]` : ""}`,
    `  market structure: ${t.structureBias ?? "n/a"}${t.structureEvent && t.structureEvent !== "none" ? ` — latest ${t.structureEvent} ${t.structureDirection} through $${n(t.structureLevel)}` : " — no recent break"}`,
  ].join("\n");
}

export async function analyzeTechnical(
  input: AnomalyResult | null,
  ctx: PanelContext,
  indicators: TechnicalIndicators | null,
): Promise<PanelSummary> {
  const hasAnomaly = !!input?.content?.trim();
  const hasIndicators = !!indicators && indicators.rsi14 !== null;
  // Nothing to show only when BOTH sources are empty.
  if (!hasAnomaly && !hasIndicators) return emptyPanel("No technical-indicator data.");

  const sections: string[] = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Window: last ${input?.timeRange ?? 30} days.`,
    "",
  ];

  if (hasIndicators) {
    sections.push(indicatorBlock(indicators!), "");
  } else {
    sections.push("Structured indicator snapshot: unavailable (sidecar /technical/indicators failed).", "");
  }

  if (hasAnomaly) {
    sections.push("moomoo technical anomaly report:", "```", input!.content.trim(), "```", "");
  } else {
    sections.push("moomoo technical anomaly report: no fresh anomaly events in the window (无异常).", "");
  }

  sections.push("Produce the panel JSON.");

  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt: sections.join("\n"),
    temperature: 0.3,
  });
}
