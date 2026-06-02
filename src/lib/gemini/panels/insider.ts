// Insider-transactions panel. Data is SEC Form 4 via Massive (ex-Polygon),
// fetched in src/lib/massive/insider.ts. Prompt body lives in ./prompts/insider.ts.
//
// Division of labour: the FLOW aggregates and the rendered transaction rows are
// computed deterministically in code (numbers must be exact); the LLM only
// writes the narrative (direction/headline/conclusion/bullets) around them.

import { genJson } from "../client";
import type {
  InsiderFlowItem,
  InsiderResult,
  InsiderTransaction,
  PanelMeta,
  PanelSummary,
} from "../../types";
import { baseSchema, emptyPanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/insider";

const SCHEMA = baseSchema();

// Compact USD, e.g. 2422421 -> "$2.4M", 504020 -> "$504K".
function money(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
}

// Row colour: open-market buys are bullish (green); only DISCRETIONARY sells are
// bearish (red). Routine 10b5-1 plan sells and comp plumbing render neutral so a
// large-cap's wall of pre-scheduled selling doesn't paint the panel red.
function flowDirection(t: InsiderTransaction): InsiderFlowItem["direction"] {
  if (t.code === "P") return "buy";
  if (t.code === "S" && t.isDiscretionary) return "sell";
  return "neutral";
}

function toFlowItem(t: InsiderTransaction): InsiderFlowItem {
  return {
    name: t.name,
    title: t.title,
    typeLabel: t.typeLabel,
    direction: flowDirection(t),
    routine: t.isPlan || !t.isOpenMarket,
    date: t.transactionDate,
    shares: t.shares,
    value: t.value,
    pctOfHoldings: t.pctOfHoldings,
  };
}

export async function analyzeInsider(
  input: InsiderResult | null,
  ctx: PanelContext,
): Promise<PanelSummary> {
  if (!input || input.transactions.length === 0) {
    return emptyPanel("No insider (Form 4) activity in the last 90 days.");
  }

  const { flow, notable } = input;

  // Deterministic meta chips — exact numbers, never routed through the LLM. The
  // chips separate conviction (Buys / Disc. Sells) from routine 10b5-1 selling
  // so the user sees at a glance how much of the activity actually matters.
  const meta: PanelMeta[] = [
    { label: "Buys", value: flow.buyCount > 0 ? `${flow.buyCount} · ${money(flow.buyValue)}` : "0" },
    { label: "Disc. Sells", value: flow.discSellCount > 0 ? `${flow.discSellCount} · ${money(flow.discSellValue)}` : "0" },
    { label: "Routine", value: flow.planSellCount > 0 ? `${flow.planSellCount} · ${money(flow.planSellValue)}` : "0" },
    { label: "Net Conviction", value: money(flow.netConviction) },
  ];

  // Deterministic transaction rows for the UI sub-block.
  const insiderFlow = notable.map(toFlowItem);

  // Prompt payload: authoritative aggregates + ranked notable rows. Each row
  // carries the 10b5-1 plan flag and % of the insider's stake so the LLM can
  // distinguish routine diversification from genuine conviction.
  const notableForPrompt = notable.map((t) => ({
    name: t.name,
    title: t.title,
    type: t.typeLabel,
    code: t.code,
    plan10b5_1: t.isPlan,
    discretionary: t.isDiscretionary,
    pctOfStake: t.pctOfHoldings === null ? null : Number((t.pctOfHoldings * 100).toFixed(1)),
    shares: t.shares,
    price: Number(t.price.toFixed(2)),
    value: Math.round(t.value),
    date: t.transactionDate,
  }));

  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Window: last 90 days of SEC Form 4 filings.`,
    "",
    "FLOW (server-computed aggregates — authoritative, do not recompute):",
    "```json",
    JSON.stringify(flow, null, 2),
    "```",
    "",
    "NOTABLE transactions (open-market first, then largest others):",
    "```json",
    JSON.stringify(notableForPrompt, null, 2),
    "```",
    "",
    "Produce the insider panel JSON. Lead with the DISCRETIONARY read (buys + non-plan sells); treat 10b5-1 plan sells and comp plumbing (grants/exercises/tax) as routine, NOT conviction.",
  ].join("\n");

  const summary = await genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });

  // Attach the deterministic blocks AFTER synthesis so the exact figures and rows
  // are guaranteed correct regardless of what the LLM echoed.
  return { ...summary, meta, insiderFlow };
}
