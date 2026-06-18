// Stock Digest panel. Web-grounded: a single Gemini + Google Search call answers
// the user's standing short-term-sentiment question (same as the Gemini web app),
// and the SAME call emits a machine-readable SIGNAL line we parse for direction.
//
// The panel renders the model's prose verbatim (PanelSummary.prose, markdown).
// The parsed SHORT-TERM direction drives the chip and — critically — feeds the
// synth's derivatives sleeve, which trades the next-month horizon.

import { genGrounded } from "../grounded";
import type { PanelDirection, PanelSummary } from "../../types";
import { DIRECTION_ENUM, emptyEvidencePanel, type PanelContext } from "./_shared";
import { SIGNAL_SENTINEL, buildDigestPrompt } from "./prompts/digest";

interface DigestCatalyst {
  event: string | null;
  date: string | null;
  confirmed: boolean;
  impact: "bullish" | "bearish" | "uncertain";
}

interface DigestSignal {
  shortTerm: PanelDirection;
  shortTermNote: string;
  catalysts: DigestCatalyst[];
}

function coerceDirection(v: unknown): PanelDirection {
  return typeof v === "string" && (DIRECTION_ENUM as string[]).includes(v)
    ? (v as PanelDirection)
    : "neutral";
}

function coerceCatalyst(v: unknown): DigestCatalyst | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const event = typeof o.event === "string" && o.event.trim() ? o.event.trim() : null;
  if (!event) return null; // no material catalyst — leave it null
  const impact =
    o.impact === "bullish" || o.impact === "bearish" ? o.impact : "uncertain";
  return {
    event,
    date: typeof o.date === "string" && o.date.trim() ? o.date.trim() : null,
    confirmed: o.confirmed === true,
    impact,
  };
}

// One-line catalyst tag for the headline (the chip + the synth's compressed view).
// Leads with the nearest catalyst and notes how many more follow; the full
// "Upcoming catalysts" list still renders from prose.
function catalystTag(catalysts: DigestCatalyst[]): string {
  const [next, ...rest] = catalysts;
  const when = next.date ? ` ${next.date}` : "";
  const status = next.confirmed ? "confirmed" : "est.";
  const more = rest.length > 0 ? ` +${rest.length} more` : "";
  return `Next catalyst: ${next.event}${when} (${status}, ${next.impact})${more}`;
}

// Split the grounded text into the user-facing prose and the parsed signal.
// The model is told to end with `===SIGNAL=== {json}`. We tolerate a missing or
// malformed signal (prose still renders; direction falls back to neutral).
function splitSignal(raw: string): { prose: string; signal: DigestSignal | null } {
  const idx = raw.lastIndexOf(SIGNAL_SENTINEL);
  if (idx === -1) return { prose: raw, signal: null };

  const prose = raw.slice(0, idx).trim();
  const tail = raw.slice(idx + SIGNAL_SENTINEL.length);
  const match = tail.match(/\{[\s\S]*\}/);
  if (!match) return { prose, signal: null };

  try {
    const j = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      prose,
      signal: {
        shortTerm: coerceDirection(j.shortTerm),
        shortTermNote: typeof j.shortTermNote === "string" ? j.shortTermNote : "",
        catalysts: Array.isArray(j.catalysts)
          ? j.catalysts.map(coerceCatalyst).filter((c): c is DigestCatalyst => c !== null)
          : [],
      },
    };
  } catch {
    return { prose, signal: null };
  }
}

export async function analyzeDigest(ctx: PanelContext): Promise<PanelSummary> {
  const { text, citations } = await genGrounded(buildDigestPrompt(ctx.ticker));
  if (!text) return emptyEvidencePanel("No web-grounded digest available.");

  const { prose, signal } = splitSignal(text);

  // Chip + synth direction = the SHORT-TERM read (derivatives horizon). The
  // headline carries the crisp short-term note so the compressed synth view has
  // a one-line bias even though the full prose is also passed through.
  const direction = signal?.shortTerm ?? "neutral";
  const note =
    signal?.shortTermNote?.trim() ||
    `${ctx.ticker} — short-term web-grounded digest`;
  // Append a one-line catalyst tag so the chip + the synth's compressed view carry
  // the nearest binary event crisply; the full "Upcoming catalysts" list is in prose.
  const headline =
    signal?.catalysts?.length ? `${note} · ${catalystTag(signal.catalysts)}` : note;

  return {
    headline,
    bullets: [],
    direction,
    prose: prose || text,
    evidence: citations.map((c) => ({ title: c.title, url: c.uri })),
  };
}
