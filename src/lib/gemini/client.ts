// OpenRouter client. OpenRouter exposes an OpenAI-compatible /chat/completions
// endpoint, so we hit it with raw fetch — no need for the openai SDK as a dep.
//
// We force JSON output via response_format=json_object and inject the JSON schema
// into the system message as documentation. Strict schema enforcement varies by
// model on OpenRouter (especially on :free / flash-lite tiers), so we rely on
// application-side parsing + retries to isolate bad outputs: cheap models
// occasionally prepend a stray char/prose (e.g. `H{ "direction": ... }`) or
// return a transient 429/5xx. extractJson() salvages the former; the retry loop
// covers the rest.
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

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; code?: number };
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

// Error carrying whether the failure is worth retrying. Auth/quota-config (401/
// 403) and malformed requests (400) are NOT retryable — they won't fix
// themselves. Rate limits (429), provider 5xx, timeouts, empty content, and
// unparseable JSON ARE retryable.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestOnce<T>(sys: string, opts: GenJsonOptions): Promise<T> {
  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${env.openrouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.openrouterAppUrl,
        "X-Title": env.openrouterAppTitle,
      },
      body: JSON.stringify({
        model: env.openrouterModel,
        temperature: opts.temperature ?? 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: opts.prompt },
        ],
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new GenJsonError(`openrouter ${res.status}: ${text.slice(0, 400)}`, retryable);
    }

    const j = (await res.json()) as ChatResponse;
    if (j.error) {
      const retryable = j.error.code === 429 || (j.error.code ?? 0) >= 500;
      throw new GenJsonError(`openrouter: ${j.error.message ?? "unknown error"}`, retryable);
    }
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new GenJsonError("openrouter returned empty content", true);
    }
    try {
      return JSON.parse(extractJson(content)) as T;
    } catch {
      throw new GenJsonError(
        `openrouter returned non-JSON content: ${content.slice(0, 200)}`,
        true,
      );
    }
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      throw new GenJsonError(`openrouter timeout after ${timeoutMs / 1000}s`, true);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function genJson<T>(opts: GenJsonOptions): Promise<T> {
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
