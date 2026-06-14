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

interface DigestSignal {
  shortTerm: PanelDirection;
  shortTermNote: string;
}

function coerceDirection(v: unknown): PanelDirection {
  return typeof v === "string" && (DIRECTION_ENUM as string[]).includes(v)
    ? (v as PanelDirection)
    : "neutral";
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
  const headline =
    signal?.shortTermNote?.trim() ||
    `${ctx.ticker} — short-term web-grounded digest`;

  return {
    headline,
    bullets: [],
    direction,
    prose: prose || text,
    evidence: citations.map((c) => ({ title: c.title, url: c.uri })),
  };
}
