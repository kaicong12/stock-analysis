// Stock Digest panel: one web-grounded call yielding verbatim prose plus a parsed short-term signal.

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

// Narrows an unknown value to a PanelDirection, defaulting to neutral.
function coerceDirection(v: unknown): PanelDirection {
  return typeof v === "string" && (DIRECTION_ENUM as string[]).includes(v)
    ? (v as PanelDirection)
    : "neutral";
}

// Narrows an unknown value to a DigestCatalyst, or null when it carries no event.
function coerceCatalyst(v: unknown): DigestCatalyst | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const event = typeof o.event === "string" && o.event.trim() ? o.event.trim() : null;
  if (!event) return null;
  const impact =
    o.impact === "bullish" || o.impact === "bearish" ? o.impact : "uncertain";
  return {
    event,
    date: typeof o.date === "string" && o.date.trim() ? o.date.trim() : null,
    confirmed: o.confirmed === true,
    impact,
  };
}

// Renders the nearest catalyst as a one-line headline tag, with a count of the rest.
function catalystTag(catalysts: DigestCatalyst[]): string {
  const [next, ...rest] = catalysts;
  const when = next.date ? ` ${next.date}` : "";
  const status = next.confirmed ? "confirmed" : "est.";
  const more = rest.length > 0 ? ` +${rest.length} more` : "";
  return `Next catalyst: ${next.event}${when} (${status}, ${next.impact})${more}`;
}

// Splits the grounded text at the signal sentinel into prose and a parsed signal, which may be absent.
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

/** Produces the Stock Digest panel from a single web-grounded call. */
export async function analyzeDigest(ctx: PanelContext): Promise<PanelSummary> {
  const { text, citations } = await genGrounded(buildDigestPrompt(ctx.ticker));
  if (!text) return emptyEvidencePanel("No web-grounded digest available.");

  const { prose, signal } = splitSignal(text);

  const direction = signal?.shortTerm ?? "neutral";
  const note =
    signal?.shortTermNote?.trim() ||
    `${ctx.ticker} — short-term web-grounded digest`;
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
