import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

const PROMPT =
  "Browse the web and tell me what are some significant things which happened over the past month that has moved the market? " +
  "Focus on: Fed/rates decisions, inflation data (CPI/PPI), major earnings reactions, geopolitical events affecting oil/commodities, " +
  "and any large sector rotations. Be concise — lead with the most market-moving facts. Use bullet points per theme.";

// The macro backdrop moves slowly (daily-ish), so we fetch it AT MOST once per
// this window across the entire server process. Bump down if you want fresher
// data; set to Infinity for strictly once-per-process.
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Module-level cache shared by every caller (the /api/macro route AND each
// batch run). Two guards prevent Gemini spam:
//   1. `cache` — a fresh successful result is reused without any API call.
//   2. `inflight` — concurrent callers (e.g. a batch firing N tickers, or the
//      client double-invoking the mount effect in dev StrictMode) all await the
//      SAME promise, so only ONE request is ever in flight.
// Failures are NOT cached, so a transient error retries on the next call.
let cache: { text: string; at: number } | null = null;
let inflight: Promise<string | null> | null = null;

async function callGemini(): Promise<string | null> {
  if (!env.geminiApiKey) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const response = await ai.models.generateContent({
      model: env.geminiModel,
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

// Returns the macro briefing text, or null on failure. Never throws.
// Guaranteed to hit Gemini at most once per TTL window, process-wide.
export async function fetchMacroContext(): Promise<string | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text; // fresh hit — no API call
  if (inflight) return inflight; // a fetch is already running — reuse it

  inflight = (async () => {
    try {
      const text = await callGemini();
      if (text !== null) cache = { text, at: Date.now() }; // only cache successes
      return text;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
