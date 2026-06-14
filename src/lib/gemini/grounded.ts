// Direct Gemini call with Google Search grounding — the same mechanism the
// Gemini web app uses: the model issues live searches, reads pages, and writes
// a free-form answer with web citations. This is the NON-streaming counterpart
// to the assistant route's streaming grounding; used by the Stock Digest panel.
//
// NOTE: the googleSearch tool and a JSON responseSchema are mutually exclusive
// in the Gemini API. We keep grounding and ask the model to emit any structured
// signal inline (parsed by the caller) rather than forcing JSON mode.
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

  // De-dup grounding chunks into citation links (same shape as the assistant route).
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
