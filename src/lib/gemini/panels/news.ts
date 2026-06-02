// News panel. Prompt mirrors the moomoo-news-search skill;
// body lives in src/lib/gemini/panels/prompts/news.ts.

import { genJson } from "../client";
import type { NewsResult, PanelSummary, PeerNewsItem } from "../../types";
import {
  EVIDENCE_PROP,
  baseSchema,
  compressNews,
  emptyEvidencePanel,
  relAge,
  type PanelContext,
} from "./_shared";
import { SYSTEM } from "./prompts/news";

// Peer read-through sub-block. Kept strictly separate from the self-news fields
// (direction/headline/bullets/evidence) — see the HARD SEPARATION RULE in the prompt.
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

const SCHEMA = baseSchema({ ...EVIDENCE_PROP, ...READTHROUGH_PROP }, ["evidence", "readThrough"]);

export async function analyzeNews(
  input: NewsResult | null,
  ctx: PanelContext,
  peerNews: PeerNewsItem[] = [],
): Promise<PanelSummary> {
  const hasSelf = !!input && input.items.length > 0;
  // Only bail when there is nothing at all; peer news alone can still produce a
  // read-through block (self fields fall back to "n/a"/empty in that case).
  if (!hasSelf && peerNews.length === 0) return emptyEvidencePanel("No recent news.");

  const now = Date.now();
  const selfItems = input && input.items.length > 0 ? compressNews(input, 12, now) : [];
  const peerItems = peerNews.map((p) => ({
    source: p.source,
    title: p.title,
    publishedAgo: relAge(p.publishTime, now),
    url: p.url,
  }));

  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}).`,
    "",
    "SELF news (most recent first) — drives direction/headline/bullets/evidence:",
    "```json",
    JSON.stringify(selfItems, null, 2),
    "```",
    "",
    "PEER news (tagged by source) — for readThrough[] ONLY, must not affect self fields:",
    "```json",
    JSON.stringify(peerItems, null, 2),
    "```",
    "",
    `Produce the news panel JSON. SELF fields reflect ${ctx.ticker} only; peers go to readThrough[]. Preserve titles and urls EXACTLY from above.`,
  ].join("\n");

  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
