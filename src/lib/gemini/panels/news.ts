// News Flow panel: a Morningstar research report as the self-signal, plus a peer read-through block.

import { genJson } from "../client";
import type { MorningstarReport, PanelSummary, PeerNewsItem } from "../../types";
import { baseSchema, emptyEvidencePanel, relAge, type PanelContext } from "./_shared";
import { SYSTEM } from "./prompts/news";

// Peer read-through sub-block, kept strictly separate from the self fields.
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

const SCHEMA = baseSchema(READTHROUGH_PROP, ["readThrough"]);

// Reduces the report to the fields the prompt reads.
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

// Builds the stat row and PDF evidence link from the report's exact figures.
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

/** Produces the News Flow panel from the Morningstar report and any peer news. */
export async function analyzeNews(
  report: MorningstarReport | null,
  ctx: PanelContext,
  peerNews: PeerNewsItem[] = [],
): Promise<PanelSummary> {
  const hasSelf = !!report && report.available;
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

  if (hasSelf) {
    return { ...summary, ...buildAttachments(report!, ctx.ticker) };
  }
  return { ...summary, evidence: [], meta: [] };
}
