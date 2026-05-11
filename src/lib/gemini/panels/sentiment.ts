// Sentiment panel. Prompt mirrors the moomoo-comment-sentiment skill;
// body lives in src/lib/gemini/panels/prompts/sentiment.ts.

import { genJson } from "../client";
import type { CommentSentimentResult, PanelSummary } from "../../types";
import {
  META_PROP,
  baseSchema,
  compressFeed,
  emptySentimentPanel,
  type PanelContext,
} from "./_shared";
import { SYSTEM } from "./prompts/sentiment";

const SCHEMA = baseSchema(META_PROP, ["meta"]);

export async function analyzeSentiment(
  input: CommentSentimentResult | null,
  ctx: PanelContext
): Promise<PanelSummary> {
  if (!input || input.posts.length === 0) return emptySentimentPanel();
  const posts = compressFeed(input, 25, Date.now());
  const prompt = [
    `Ticker: ${ctx.ticker} (${ctx.symbol}). Sample size: ${posts.length} community posts.`,
    "",
    "Posts:",
    "```json",
    JSON.stringify(posts, null, 2),
    "```",
    "",
    "Produce the sentiment panel JSON, including the 4-entry meta array with computed percentages.",
  ].join("\n");
  return genJson<PanelSummary>({
    systemInstruction: SYSTEM,
    schema: SCHEMA,
    prompt,
    temperature: 0.3,
  });
}
