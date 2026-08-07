import { genJson } from "../client";
import type { PanelSummary } from "../../types";
import type { ScoredExpiry, ScoredStrike, WheelPlan } from "../../wheel/types";
import { baseSchema, emptyPanel, META_PROP, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/wheel";

const SCHEMA = baseSchema(META_PROP);

const pct = (x: number | null, d = 1): string => (x === null ? "n/a" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null, d = 2): string => (x === null ? "n/a" : x.toFixed(d));

function regimeBlock(plan: WheelPlan): string {
  const r = plan.regime;
  if (!r) return "Vol regime: unavailable (sidecar /vol/regime failed).";
  return [
    `Vol regime (label: ${r.label}) — PROXY for IV Rank, built from REALIZED vol:`,
    `  HV30: ${pct(r.hv30)} — ${r.hv30Pct === null ? "n/a" : `${r.hv30Pct} percentile`} of its trailing year (range ${pct(r.hv30Low)}–${pct(r.hv30High)}, ${r.sampleBars} bars)`,
    `  ATM IV: ${pct(r.atmIv)}${r.dte ? ` (${r.dte} DTE, expiry ${r.expiryUsed})` : ""}`,
    `  IV/HV30: ${num(r.ivHv30, 2)}`,
  ].join("\n");
}

function zoneBlock(plan: WheelPlan): string {
  const z = plan.zone;
  if (!z) return "Acquisition zone: unavailable (fewer than two anchors present).";
  const a = z.anchors;
  return [
    `Acquisition zone: $${num(z.low)} – $${num(z.high)}${z.partial ? " (PARTIAL — only two anchors)" : ""}`,
    `  analyst target-low: ${a.analystTargetLow === null ? "n/a" : `$${num(a.analystTargetLow)}`}`,
    `  SMA200: ${a.sma200 === null ? "n/a" : `$${num(a.sma200)}`}`,
    `  nearest support: ${a.support === null ? "n/a" : `$${num(a.support)}`}`,
  ].join("\n");
}

function flag(v: boolean | null): string {
  return v === null ? "?" : v ? "yes" : "no";
}

function rowLine(r: ScoredStrike): string {
  const marks = [r.safest ? "SAFEST" : "", r.richest ? "RICHEST" : ""].filter(Boolean).join(" ");
  return (
    `  strike $${num(r.strike)} | delta ${num(r.delta, 3)} | mid $${num(r.mid)} | ` +
    `annYield ${r.annYield === null ? "n/a" : `${r.annYield}%`} | zone ${r.zonePos} | ` +
    `clearsEM ${flag(r.clearsEm)} | clearsLevel ${flag(r.clearsLevel)} | ` +
    `liquid ${flag(r.liquid)} (OI ${num(r.openInterest, 0)}, spread ${r.spreadPct === null ? "n/a" : `${r.spreadPct}%`})` +
    (marks ? ` | ${marks}` : "")
  );
}

// Cap rows per expiry: the far tail carries no premium worth naming and would
// crowd out the other expiries in the prompt.
const MAX_ROWS = 10;

function legBlock(label: string, legs: ScoredExpiry[]): string {
  if (!legs.length) return `${label}: no quotable strikes.`;
  const out: string[] = [label];
  for (const e of legs) {
    const notes = [
      e.earningsInWindow ? "EARNINGS INSIDE WINDOW" : "",
      e.exDivInWindow ? "EX-DIV INSIDE WINDOW" : "",
    ].filter(Boolean).join("; ");
    out.push(
      `  expiry ${e.expiry} (${e.dte} DTE) — ATM IV ${pct(e.atmIv)}, ` +
        `1-SD band $${num(e.emLower)}–$${num(e.emUpper)}${notes ? ` — ${notes}` : ""}`,
    );
    if (!e.rows.length) {
      out.push("  (no quotable strikes at this expiry)");
      continue;
    }
    for (const r of e.rows.slice(0, MAX_ROWS)) out.push(rowLine(r));
  }
  return out.join("\n");
}

export async function analyzeWheel(plan: WheelPlan, ctx: PanelContext): Promise<PanelSummary> {
  const hasChain = plan.putLeg.some((e) => e.rows.length) || plan.callLeg.some((e) => e.rows.length);
  if (!hasChain && !plan.zone && !plan.regime) return emptyPanel("No wheel data.");

  const sections: string[] = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Spot: ${plan.spot === null ? "n/a" : `$${num(plan.spot)}`}.`,
    "",
    regimeBlock(plan),
    "",
    zoneBlock(plan),
    "",
    legBlock("PUT LEG (start the wheel):", plan.putLeg),
    "",
    legBlock("CALL LEG (only if already holding 100+ shares):", plan.callLeg),
    "",
  ];
  if (plan.warning) {
    sections.push(
      plan.blocked
        ? `BLOCKING WARNING — no new put entry: ${plan.warning}`
        : `WARNING (not blocking): ${plan.warning}`,
      "",
    );
  }
  sections.push(
    "meta: 4 stats — Regime, Zone, Best put strike, Ann. yield. Use \"—\" when unavailable.",
    "Produce the panel JSON.",
  );

  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt: sections.join("\n"),
    temperature: 0.3,
  });
}
