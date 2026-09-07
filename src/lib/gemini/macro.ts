// Web-grounded macro backdrop briefing, cached process-wide.

import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

const PROMPT =
  "Browse the web and brief me on the macro backdrop for US equities. Every line must say what it MEANS for the stock market — " +
  "a bare fact or a bare calendar entry is useless to me. Three short sections:\n\n" +
  "(1) Regime — the Fed/rate stance and the latest inflation trend (CPI/PPI/PCE) as STANDING STATE, not a recap of past events. " +
  "For each, state the read-through in the same bullet: which way it pushes equity multiples, and whether it is currently a tailwind, " +
  "a headwind, or neutral for a broad long-only equity book.\n\n" +
  "(2) Dominant risk — the single biggest thing that could reprice the index in the next ~60 days, and what a move in it does to stocks " +
  "(direction and rough magnitude of the reaction).\n\n" +
  "(3) Calendar (next ~60 days), nearest first, each WITH ITS DATE — FOMC, CPI/PPI, Non-Farm Payrolls, PCE, GDP, and any other major " +
  "known catalyst. For EACH event give one line in the form: what the market is currently pricing in, then **what happens to equities " +
  "if it comes in hot vs. soft**. Skip events with no plausible market impact.\n\n" +
  "Close with one line: what this backdrop means for equity volatility over the next 30-45 days (elevated / calm / event-driven around " +
  "specific dates), since that is the window I sell options in.\n\n" +
  "Bullet points, one or two sentences each, no preamble. Do NOT recap past events that are already priced in. " +
  "Do NOT mention individual tickers or give trade recommendations — this is index-level context only.";

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Process-wide cache plus in-flight dedupe; failures are never cached.
let cache: { text: string; at: number } | null = null;
let inflight: Promise<string | null> | null = null;

// Runs the grounded macro request, returning null on a missing key or any error.
async function callGemini(): Promise<string | null> {
  if (!env.geminiApiKey) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const response = await ai.models.generateContent({
      model: env.geminiGroundedModel,
      contents: [{ role: "user", parts: [{ text: PROMPT }] }],
      config: { tools: [{ googleSearch: {} }] },
    });
    const text =
      response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return text.trim() ? text : null;
  } catch (e) {
    console.error("[macro] Gemini error:", (e as Error).message);
    return null;
  }
}

/** Returns the macro briefing text, or null on failure; hits Gemini at most once per TTL window. */
export async function fetchMacroContext(): Promise<string | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const text = await callGemini();
      if (text !== null) cache = { text, at: Date.now() };
      return text;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
