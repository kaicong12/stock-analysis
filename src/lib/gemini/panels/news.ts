// News Flow panel. Self-signal is a Morningstar research report (OpenD), which
// replaced the recency-sorted moomoo news feed. The peer read-through sub-block
// is unchanged and still rides on this panel. Prompt body lives in
// src/lib/gemini/panels/prompts/news.ts.

import { genJson } from "../client";
import type { MorningstarReport, PanelSummary, PeerNewsItem } from "../../types";
import { baseSchema, emptyEvidencePanel, relAge, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/news";

// Peer read-through sub-block. Kept strictly separate from the self fields
// (direction/headline/bullets) — see the HARD SEPARATION RULE in the prompt.
const READTHROUGH_PROP = {
  readThrough: {
    type: "array",
    items: {
      type: "object",
      properties: {
        peer: { type: "string" },
        classification: {
          type: "string",
          enum: ["sector-sentiment", "competitive", "shared-input"],
        },
        direction: { type: "string", enum: ["bullish", "bearish", "neutral"] },
        note: { type: "string" },
        url: { type: "string" },
      },
      required: ["peer", "classification", "direction", "note", "url"],
    },
  },
};

// The LLM writes direction/headline/conclusion/bullets/readThrough. evidence
// (the report PDF link) and meta (the FVE/rating/moat stat row) are attached
// deterministically in code — exact numbers, no hallucination.
const SCHEMA = baseSchema(READTHROUGH_PROP, ["readThrough"]);

function compressReport(r: MorningstarReport) {
  return {
    starRating: r.starRating,
    ratingType: r.ratingType,
    fairValue: r.fairValue,
    fairValueNote: r.fairValueNote,
    economicMoatLabel: r.economicMoatLabel,
    uncertaintyLabel: r.uncertaintyLabel,
    financialHealthLabel: r.financialHealthLabel,
    capitalAllocationLabel: r.capitalAllocationLabel,
    bullSay: r.bullSay,
    bearSay: r.bearSay,
    analystNoteTitle: r.analystNoteTitle,
    analystNote: r.analystNote,
    investmentThesis: r.investmentThesis,
    valuationNote: r.valuationNote,
    starUpdateTimeStr: r.starUpdateTimeStr,
    analystReportUpdateTimeStr: r.analystReportUpdateTimeStr,
  };
}

// Deterministic stat row + PDF evidence link (attached post-LLM for exactness).
function buildAttachments(
  report: MorningstarReport,
  ticker: string,
): Pick<PanelSummary, "evidence" | "meta"> {
  const fv =
    report.fairValue != null
      ? `$${report.fairValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : "—";
  return {
    meta: [
      { label: "Rating", value: report.starRating != null ? `${report.starRating}★` : "—" },
      { label: "Fair Value", value: fv },
      { label: "Moat", value: report.economicMoatLabel ?? "—" },
      { label: "Uncertainty", value: report.uncertaintyLabel ?? "—" },
    ],
    evidence: report.pdfUrl
      ? [
          {
            title: report.analystNoteTitle || `Morningstar research report — ${ticker}`,
            url: report.pdfUrl,
          },
        ]
      : [],
  };
}

export async function analyzeNews(
  report: MorningstarReport | null,
  ctx: PanelContext,
  peerNews: PeerNewsItem[] = [],
): Promise<PanelSummary> {
  const hasSelf = !!report && report.available;
  // Only bail when there is nothing at all; peer news alone can still produce a
  // read-through block (self fields fall back to "n/a"/empty in that case).
  if (!hasSelf && peerNews.length === 0) {
    return emptyEvidencePanel("No Morningstar report available.");
  }

  const now = Date.now();
  const peerItems = peerNews.map((p) => ({
    source: p.source,
    title: p.title,
    publishedAgo: relAge(p.publishTime, now),
    url: p.url,
  }));

  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}).`,
    "",
    "SELF — Morningstar research report (drives direction/headline/conclusion/bullets):",
    "```json",
    JSON.stringify(hasSelf ? compressReport(report!) : { available: false }, null, 2),
    "```",
    "",
    "PEER news (tagged by source) — for readThrough[] ONLY, must not affect self fields:",
    "```json",
    JSON.stringify(peerItems, null, 2),
    "```",
    "",
    `Produce the News Flow panel JSON. SELF fields reflect ${ctx.ticker}'s Morningstar report only; peers go to readThrough[]. Preserve peer titles and urls EXACTLY.`,
  ].join("\n");

  const summary = await genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });

  // Attach the deterministic stat row + PDF link only when we actually have a
  // report (peer-only runs keep empty evidence/meta).
  if (hasSelf) {
    return { ...summary, ...buildAttachments(report!, ctx.ticker) };
  }
  return { ...summary, evidence: [], meta: [] };
}
