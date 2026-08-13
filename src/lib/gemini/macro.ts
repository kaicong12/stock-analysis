// Web-grounded macro backdrop briefing, cached process-wide.

import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

const PROMPT =
  "Browse the web and give me the CURRENT macro backdrop plus the upcoming macro calendar for the next ~60 days. " +
  "Two short sections:\n" +
  "(1) Current regime — the Fed/rate stance, the latest inflation trend (CPI/PPI/PCE), and the single dominant market risk right now. " +
  "This is standing state, not a recap of past events.\n" +
  "(2) Upcoming scheduled events (next ~60 days), each WITH ITS DATE — FOMC meetings, CPI/PPI releases, Non-Farm Payrolls, GDP prints, " +
  "PCE, and any other major known macro catalysts. Lead with the nearest dated events.\n" +
  "Be concise — bullet points per item. Do NOT recap past events that are already priced in.";

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
