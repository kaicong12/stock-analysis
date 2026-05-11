// OpenRouter client. OpenRouter exposes an OpenAI-compatible /chat/completions
// endpoint, so we hit it with raw fetch — no need for the openai SDK as a dep.
//
// We force JSON output via response_format=json_object and inject the JSON schema
// into the system message as documentation. Strict schema enforcement varies by
// model on OpenRouter (especially on :free tiers), so we rely on application-side
// JSON.parse + the route's settle() wrapper to isolate any bad outputs.
import { env } from "../env";

export interface GenJsonOptions {
  systemInstruction: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; code?: number };
}

const DEFAULT_TIMEOUT_MS = 120_000;

function stripJsonFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

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
      throw new Error(`openrouter ${res.status}: ${text.slice(0, 400)}`);
    }

    const j = (await res.json()) as ChatResponse;
    if (j.error) {
      throw new Error(`openrouter: ${j.error.message ?? "unknown error"}`);
    }
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("openrouter returned empty content");
    }
    return JSON.parse(stripJsonFence(content)) as T;
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      throw new Error(`openrouter timeout after ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
