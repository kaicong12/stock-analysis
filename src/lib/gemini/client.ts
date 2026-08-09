// Structured-JSON LLM client. Calls the Google Gemini API directly (Google AI
// Studio key) via @google/genai — the same SDK the web-grounded surfaces use.
//
// We force JSON output via responseMimeType="application/json" and inject the
// JSON schema into the system instruction as documentation. We deliberately do
// NOT pass a strict Gemini responseSchema: the panel/synth schemas use JSON
// Schema features (mixed type arrays like ["integer","null"], minimum/maximum)
// that Gemini's OpenAPI-subset responseSchema does not accept. Keeping the
// schema-as-docs approach lets the existing schemas ride unchanged.
//
// This path is NON-grounded (no googleSearch tool) — it reasons only over the
// data in the prompt. Cheap/flash-lite tiers occasionally prepend a stray
// char/prose (e.g. `H{ "direction": ... }`) or hit a transient 429/5xx /
// overload, so we rely on application-side resilience: extractJson() salvages
// malformed-but-recoverable output, and the retry loop covers the rest.
import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

export interface GenJsonOptions {
  systemInstruction: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
  // Total attempts including the first try. Default MAX_ATTEMPTS.
  attempts?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

// Error carrying whether the failure is worth retrying. Auth/quota-config and
// malformed requests are NOT retryable — they won't fix themselves. Rate limits
// (429), server overload (5xx), timeouts, empty content, and unparseable JSON
// ARE retryable.
class GenJsonError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "GenJsonError";
    this.retryable = retryable;
  }
}

function stripJsonFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

// Salvage a JSON object from content that has stray leading/trailing characters
// (the cheap-model `H{...}` failure) by slicing to the outermost braces. Leaves
// well-formed content untouched.
function extractJson(s: string): string {
  const stripped = stripJsonFence(s);
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  return first >= 0 && last > first ? stripped.slice(first, last + 1) : stripped;
}

// Heuristic for transient Gemini/SDK failures worth retrying: rate limits (429),
// server overload (5xx), and the SDK's UNAVAILABLE / RESOURCE_EXHAUSTED states.
// Unknown errors are treated as non-retryable so auth/bad-request failures fail
// fast instead of burning attempts.
function isTransientApiError(e: unknown): boolean {
  const err = e as { status?: number; code?: number; message?: string };
  const status = err.status ?? err.code;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  const msg = (err.message ?? "").toLowerCase();
  return /\b(429|5\d\d)\b|too many requests|rate.?limit|overloaded|unavailable|resource.?exhausted|internal error/.test(
    msg,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestOnce<T>(sys: string, opts: GenJsonOptions): Promise<T> {
  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

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
      throw new GenJsonError("gemini returned empty content", true);
    }
    try {
      return JSON.parse(extractJson(text)) as T;
    } catch {
      throw new GenJsonError(`gemini returned non-JSON content: ${text.slice(0, 200)}`, true);
    }
  } catch (e) {
    if (e instanceof GenJsonError) throw e;
    if ((e as { name?: string }).name === "AbortError") {
      throw new GenJsonError(`gemini timeout after ${timeoutMs / 1000}s`, true);
    }
    throw new GenJsonError(
      `gemini: ${(e as { message?: string }).message ?? "unknown error"}`,
      isTransientApiError(e),
    );
  } finally {
    clearTimeout(timer);
  }
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

  const maxAttempts = Math.max(1, opts.attempts ?? MAX_ATTEMPTS);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestOnce<T>(sys, opts);
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof GenJsonError ? e.retryable : false;
      if (!retryable || attempt === maxAttempts) throw e;
      // Exponential backoff with a little headroom: 400ms, 800ms, ...
      await sleep(400 * 2 ** (attempt - 1));
    }
  }
  throw lastErr; // unreachable — loop either returns or throws.
}
