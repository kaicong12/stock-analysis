// Browser-side client for the /api/assistant SSE stream. Yields parsed events
// from a fetched event-stream body.
export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "citations"; citations: { title: string; uri: string }[] }
  | { type: "done" }
  | { type: "error"; message: string };

export type ChatMessage = { role: "user" | "assistant"; content: string };

interface StreamRequest {
  ticker: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export async function* streamAssistant(req: StreamRequest): AsyncGenerator<AssistantEvent> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: req.ticker, messages: req.messages }),
    signal: req.signal,
  });

  // Non-stream JSON error path (e.g. missing key, bad request).
  if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) message = j.error;
    } catch {}
    yield { type: "error", message };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        let eventName = "message";
        let dataStr = "";
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;

        try {
          const data = JSON.parse(dataStr);
          if (eventName === "text") {
            yield { type: "text", delta: data.delta ?? "" };
          } else if (eventName === "citations") {
            yield { type: "citations", citations: data.citations ?? [] };
          } else if (eventName === "error") {
            yield { type: "error", message: data.message ?? "stream error" };
          } else if (eventName === "done") {
            yield { type: "done" };
          }
        } catch {
          // Skip malformed event payloads — stream may continue with valid ones.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
