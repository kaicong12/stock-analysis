// Web-grounded news fetch for the Stock Digest panel — Gemini direct API with
// Google Search grounding (same key/pattern as macro.ts and /api/assistant).
// This replaced the moomoo keyword feed, which surfaced anything *mentioning*
// the ticker; search grounding is asked specifically for price-moving catalysts.
//
// Quota note: this is the only per-ticker consumer of GEMINI_API_KEY (macro is
// cached 6h process-wide, assistant is per user message). One call per ticker
// per run, fired at batch concurrency (≤10) — comfortably inside the free
// tier's 15 RPM / 1500 RPD.
import { GoogleGenAI } from "@google/genai";
import { env } from "../env";
import type { WebNewsResult, WebNewsSource } from "../types";

interface GroundingSupport {
  segment?: { startIndex?: number; endIndex?: number };
  groundingChunkIndices?: number[];
}

function buildPrompt(ticker: string): string {
  return [
    `Browse the web for recent news on the stock with ticker ${ticker}.`,
    "Report the 5-8 most PRICE-RELEVANT news items from roughly the past week — catalysts that moved",
    "or are likely to move the stock price (earnings, guidance, capital raises, M&A, regulatory or",
    "antitrust actions, product announcements with revenue impact, analyst actions, major capex news).",
    "For each item give: a headline, the date, the source, and one or two lines on why it matters for",
    "the stock price. Exclude generic listicles, 'best stocks to buy' content, and items where the",
    "company is only tangentially mentioned.",
  ].join(" ");
}

// Grounding supports carry BYTE offsets into the UTF-8 text. Insert " [n,m]"
// markers after each supported segment (back to front so offsets stay valid)
// so the downstream digest model can map each news item to its sources.
function inlineCitations(text: string, supports: GroundingSupport[]): string {
  const buf = Buffer.from(text, "utf8");
  const inserts = supports
    .filter((s) => typeof s.segment?.endIndex === "number" && (s.groundingChunkIndices?.length ?? 0) > 0)
    .map((s) => ({
      at: s.segment!.endIndex!,
      marker: ` [${s.groundingChunkIndices!.map((i) => i + 1).join(",")}]`,
    }))
    .sort((a, b) => b.at - a.at);
  let out = buf;
  for (const ins of inserts) {
    if (ins.at > out.length) continue;
    out = Buffer.concat([out.subarray(0, ins.at), Buffer.from(ins.marker, "utf8"), out.subarray(ins.at)]);
  }
  return out.toString("utf8");
}

// Returns null when the key is missing or Gemini comes back empty (panel
// degrades to its empty state); throws on API errors so runPanel's settle
// wrapper surfaces a proper panel error.
export async function searchStockNews(ticker: string, symbol: string): Promise<WebNewsResult | null> {
  if (!env.geminiApiKey) return null;

  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const response = await ai.models.generateContent({
    model: env.geminiModel,
    contents: [{ role: "user", parts: [{ text: buildPrompt(ticker) }] }],
    config: { tools: [{ googleSearch: {} }] },
  });

  const candidate = response.candidates?.[0];
  const rawText = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!rawText.trim()) return null;

  const meta = candidate?.groundingMetadata;
  const sources: WebNewsSource[] = (meta?.groundingChunks ?? []).map((gc, i) => ({
    index: i + 1,
    // web.title is typically the source domain (e.g. "reuters.com"); web.uri is
    // an opaque Google grounding redirect that resolves to the article.
    domain: gc.web?.title ?? "unknown",
    url: gc.web?.uri ?? "",
  }));

  const text = inlineCitations(rawText, (meta?.groundingSupports ?? []) as GroundingSupport[]);
  return { symbol, text, sources };
}
