// Prompt for the web-grounded Stock Digest panel.
//
// The model runs with Google Search grounding (see grounded.ts), so this is a
// plain user prompt — NOT a structured-JSON system prompt. It reproduces the
// Gemini web experience for the user's standing question, then appends a
// machine-readable SIGNAL line the panel parses for the direction chip + synth.
//
// The signal reports a single SHORT-TERM (next-month) direction — that is the
// horizon the derivatives sleeve trades, so the prompt keeps it explicitly
// scoped to the next month rather than a blurred multi-quarter view.

export const SIGNAL_SENTINEL = "===SIGNAL===";

export function buildDigestPrompt(ticker: string): string {
  return [
    `What happened to ${ticker} stock price and what do you think of the short term sentiment for this ticker? E.g. within the next month`,
    "",
    "Focus especially on the SHORT-TERM (next ~1 month) directional setup — recent",
    "price action, momentum, near-term catalysts, technical posture, and options",
    "positioning — not just the long-term analyst view. Be concrete about what could",
    "move it over the next few weeks and the likely direction of each driver. Do not",
    "over-summarise: keep the specific numbers, levels, and dates.",
    "",
    `After your written answer, output a final line that starts with exactly`,
    `"${SIGNAL_SENTINEL}" followed by one JSON object and nothing else:`,
    `{"shortTerm":"<bullish|bearish|neutral|mixed>","shortTermNote":"<max 20 words on the next-month directional bias>"}.`,
    "shortTerm is your read for the NEXT MONTH specifically (the derivatives horizon).",
    "Do not wrap the JSON in code fences.",
  ].join("\n");
}
