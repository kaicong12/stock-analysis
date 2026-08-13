// Non-streaming Gemini call with Google Search grounding, returning prose plus citations.

// The googleSearch tool and a JSON responseSchema are mutually exclusive in the Gemini API.
import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

export interface GroundedCitation {
  title: string;
  uri: string;
}

export interface GroundedResult {
  text: string;
  citations: GroundedCitation[];
}

/** Runs a web-grounded prompt and returns its text with deduped citation links. */
export async function genGrounded(
  prompt: string,
  opts?: { model?: string },
): Promise<GroundedResult> {
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const response = await ai.models.generateContent({
    model: opts?.model ?? env.geminiGroundedModel,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { tools: [{ googleSearch: {} }] },
  });

  const cand = response.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  const citations: GroundedCitation[] = [];
  const seen = new Set<string>();
  for (const gc of cand?.groundingMetadata?.groundingChunks ?? []) {
    const uri = gc.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      citations.push({ title: gc.web?.title ?? uri, uri });
    }
  }

  return { text: text.trim(), citations };
}
