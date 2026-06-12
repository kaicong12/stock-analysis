// Digest panel. Input is the web-grounded news briefing from webNews.ts
// (Gemini + Google Search); this stage structures it into the panel JSON via
// the usual OpenRouter genJson path, so the search call is the only direct
// Gemini API hit per ticker. Prompt body lives in prompts/digest.ts.

import { genJson } from "../client";
import type { PanelSummary, WebNewsResult } from "../../types";
import { baseSchema, emptyEvidencePanel, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/digest";

// Digest evidence carries a per-item summary (headline + why-it-matters) —
// stricter than the shared EVIDENCE_PROP used by the other panels.
const EVIDENCE_WITH_SUMMARY_PROP = {
  evidence: {
    type: "array",
    items: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        url: { type: "string" },
      },
      required: ["title", "summary", "url"],
    },
  },
};

const SCHEMA = baseSchema(EVIDENCE_WITH_SUMMARY_PROP, ["evidence"]);

export async function analyzeDigest(
  input: WebNewsResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || !input.text.trim()) {
    return emptyEvidencePanel("No obvious new stock-specific factors.");
  }
  const sourceList = input.sources.length
    ? input.sources.map((s) => `${s.index}. ${s.domain} — ${s.url}`).join("\n")
    : "(no grounded sources returned — use \"\" for every evidence url)";
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}).`,
    "",
    "Web-search briefing (citation markers [n] refer to the numbered sources below):",
    "```",
    input.text,
    "```",
    "",
    "Numbered sources:",
    sourceList,
    "",
    "Produce the digest panel JSON. Every evidence url must be copied EXACTLY from the numbered sources (or \"\" if none matches).",
  ].join("\n");
  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
