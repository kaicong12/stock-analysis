// Structured-JSON LLM client. Calls the Google Gemini API directly (Google AI
// Studio key) via @google/genai — the same SDK the web-grounded surfaces use.
//
// We force JSON output via responseMimeType="application/json" and inject the
// JSON schema into the system instruction as documentation. We deliberately do
// NOT pass a strict Gemini responseSchema: the panel/synth schemas use JSON
// Schema features (mixed type arrays like ["integer","null"], minimum/maximum)
// that Gemini's OpenAPI-subset responseSchema does not accept. Keeping the
// schema-as-docs approach lets the existing schemas ride unchanged; we rely on
// application-side JSON.parse + each route's settle() wrapper to isolate any bad
// outputs. This path is NON-grounded (no googleSearch tool) — it reasons only
// over the data in the prompt.
import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

export interface GenJsonOptions {
  systemInstruction: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function stripJsonFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export async function genJson<T>(opts: GenJsonOptions): Promise<T> {
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");

  const schemaText = JSON.stringify(opts.schema, null, 2);
  const sys = `${opts.systemInstruction}

---

Respond ONLY with a single valid JSON object matching this schema:

\`\`\`json
${schemaText}
\`\`\`

No prose, no markdown fences, no commentary — only the JSON object.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const response = await ai.models.generateContent({
      model: env.geminiStructuredModel,
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      config: {
        systemInstruction: sys,
        temperature: opts.temperature ?? 0.3,
        responseMimeType: "application/json",
        abortSignal: ctrl.signal,
      },
    });

    const text =
      response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      throw new Error("gemini returned empty content");
    }
    return JSON.parse(stripJsonFence(text)) as T;
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      throw new Error(`gemini timeout after ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
