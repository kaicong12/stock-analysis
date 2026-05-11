// Fundamentals panel. Pulls yfinance data via the python sidecar and asks
// Gemini to read it as a structured panel (valuation, growth, profitability,
// balance sheet, analyst view, earnings calendar).

import { genJson } from "../client";
import type { FundamentalsResult, PanelSummary } from "../../types";
import {
  META_PROP,
  baseSchema,
  emptyPanel,
  type PanelContext,
} from "./_shared";
import { SYSTEM } from "./prompts/fundamentals";

const SCHEMA = baseSchema(META_PROP, ["meta"]);

// Drop null fields so the prompt isn't 70% nulls.
function compactData(data: FundamentalsResult["data"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

function daysUntilISO(iso: string | null): number | null {
  if (!iso) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
}

export async function analyzeFundamentals(
  input: FundamentalsResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || !input.data) return emptyPanel("No fundamentals data.");
  const compact = compactData(input.data);
  if (Object.keys(compact).length === 0) return emptyPanel("No fundamentals data.");

  const earningsDte = daysUntilISO(input.data.nextEarningsDate);

  const payload = {
    ticker: ctx.ticker,
    symbol: ctx.symbol,
    yfTicker: input.yfTicker,
    fundamentals: compact,
    earningsDaysAway: earningsDte,
  };

  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}).`,
    "",
    "yfinance fundamentals snapshot (null fields omitted):",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "Produce the fundamentals panel JSON. Cite only numbers from the snapshot.",
  ].join("\n");

  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
