// Streaming research-assistant endpoint. Forwards a multi-turn chat to
// Gemini with Google Search grounding always enabled, and pipes the response
// back to the browser over Server-Sent Events. Free-tier API key (no billing)
// is the expected configuration.
import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface RequestBody {
  ticker?: string;
  messages?: ChatMessage[];
}

interface Citation {
  title: string;
  uri: string;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  if (!env.geminiApiKey) {
    return Response.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ticker = (body.ticker ?? "").trim().toUpperCase();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!ticker) {
    return Response.json({ error: "ticker is required" }, { status: 400 });
  }
  if (messages.length === 0) {
    return Response.json({ error: "messages cannot be empty" }, { status: 400 });
  }

  // Gemini's contents array: each turn has role "user" | "model" with parts[].
  // The first message is always user; subsequent must alternate.
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const systemInstruction = [
    `You are a research assistant for the ticker ${ticker}.`,
    "The user is a conservative options trader using a stock-analysis dashboard.",
    "They reach you when the dashboard's panel consensus is unclear or conflicting.",
    "Use Google Search to ground answers in current data — prices, news, analyst",
    "actions, and option metrics. Be direct and concise; lead with the answer,",
    "then 2-4 supporting bullets. Avoid hedging boilerplate. Always add a one-line",
    "non-advice disclaimer at the end.",
  ].join(" ");

  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        const response = await ai.models.generateContentStream({
          model: env.geminiModel,
          contents,
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }],
          },
        });

        const citations: Citation[] = [];
        const seenUris = new Set<string>();

        for await (const chunk of response) {
          const text = chunk.text;
          if (text) send("text", { delta: text });

          // Grounding chunks accumulate across the stream; capture each new one.
          const groundingChunks =
            chunk.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
          for (const gc of groundingChunks) {
            const uri = gc.web?.uri;
            const title = gc.web?.title;
            if (uri && !seenUris.has(uri)) {
              seenUris.add(uri);
              citations.push({ title: title ?? uri, uri });
            }
          }
        }

        if (citations.length > 0) send("citations", { citations });
        send("done", {});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
