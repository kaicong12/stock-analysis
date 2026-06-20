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
    `IMPORTANT — look beyond ${ticker} itself. ${ticker} often moves on a CORRELATED name`,
    "or a SECTOR/THEME repricing rather than its own news (e.g. a close peer's results or",
    "guidance, a shared supplier/customer, a mega-cap complex move, an AI-capex / rates /",
    "regulatory shock). When the recent move OR an upcoming driver is really coming from a",
    `related ticker or sector event, SAY SO EXPLICITLY and name the peer ticker + the event +`,
    "its date — do not attribute a sector-driven move to a company-specific cause.",
    "",
    "Structure your written answer with these markdown sections, in this order:",
    "",
    "## Short-term read",
    "Recent price action, momentum, technicals, and options positioning for the next ~1 month.",
    "",
    "## Upcoming catalysts",
    `Search for the SCHEDULED OR EXPECTED events most likely to move ${ticker} over the`,
    "next ~6 weeks — e.g. earnings, an analyst/investor day, a product launch or event,",
    "ex-dividend, FDA/PDUFA or regulatory decision, lockup expiry, index rebalancing, or a",
    "known macro print the name is sensitive to. INCLUDE catalysts from closely correlated",
    `names / sector peers when they are likely to move ${ticker} (name the peer in the event`,
    "label, e.g. \"NVDA earnings (peer read-through)\"). List ALL the material ones you find,",
    "ordered soonest first (don't pad with immaterial ones). For each, state: the event, its",
    "date (exact ISO date if scheduled; otherwise an estimated window, said to be estimated),",
    "whether it is CONFIRMED or ESTIMATED, and the likely price-impact direction",
    "(bullish/bearish/uncertain) with one line of reasoning. If no material catalyst is on the",
    "radar, say so explicitly.",
    "",
    "## Bull case",
    "Up to 4 concise bullets: the strongest reasons the stock rises over the next month.",
    "Only include this section if there is a genuine bull case grounded in what you found —",
    "do NOT manufacture weak points to fill it. Omit the section entirely if there isn't one.",
    "",
    "## Bear case",
    "Up to 4 concise bullets: the strongest reasons the stock falls over the next month.",
    "Only include this section if there is a genuine bear case grounded in what you found —",
    "do NOT manufacture weak points to fill it. Omit the section entirely if there isn't one.",
    "",
    "Keep every claim grounded in what you found via search; cite concrete numbers, levels, and dates.",
    "",
    `After your written answer, output a final line that starts with exactly`,
    `"${SIGNAL_SENTINEL}" followed by one JSON object and nothing else:`,
    `{"shortTerm":"<bullish|bearish|neutral|mixed>","shortTermNote":"<max 20 words on the next-month directional bias>","catalysts":[{"event":"<short label>","date":"<YYYY-MM-DD, or an estimated-window string, or null>","confirmed":<true|false>,"impact":"<bullish|bearish|uncertain>"}]}.`,
    "shortTerm is your read for the NEXT MONTH specifically (the derivatives horizon).",
    "catalysts mirrors the Upcoming catalysts section, ordered soonest first; use an empty array [] when no material catalyst exists.",
    "Do not wrap the JSON in code fences.",
  ].join("\n");
}
