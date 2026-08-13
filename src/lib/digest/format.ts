// Renders the digest's deterministic blocks for prompts. Imports nothing that reaches env.ts, so tests can load it.

import { daysUntilISO } from "../date";
import type { MarketTape } from "./types";

// FOMC sits ~6 weeks apart, so a ten-day runway would usually be empty.
export const FOMC_WINDOW_DAYS = 21;

/** Formats the tape as labelled levels plus the VIX percentile and its sample size. */
export function formatTape(tape: MarketTape | null): string {
  if (!tape) return "(tape unavailable — the sidecar did not respond)";

  const lines = tape.quotes.map((q) => {
    if (q.last === null) return `${q.label}: unavailable`;
    const change =
      q.changePct === null
        ? ""
        : ` (${q.changePct >= 0 ? "+" : ""}${q.changePct}% vs prior close)`;
    return `${q.label}: ${q.last}${change}`;
  });

  if (tape.vix) {
    lines.push(
      tape.vix.pct === null
        ? `VIX percentile: unavailable (only ${tape.vix.barsRanked} sessions available)`
        : `VIX percentile: ${tape.vix.pct} over the last ${tape.vix.barsRanked} sessions ` +
          `(range ${tape.vix.low}–${tape.vix.high})`,
    );
  }

  return `As of ${tape.asOf ?? "unknown"}\n${lines.join("\n")}`;
}

/** Formats FOMC decision dates falling inside the runway window. */
export function formatFomc(dates: string[]): string {
  const upcoming = dates
    .map((d) => ({ d, days: daysUntilISO(d) }))
    .filter((x): x is { d: string; days: number } =>
      x.days !== null && x.days >= 0 && x.days <= FOMC_WINDOW_DAYS);

  if (!upcoming.length) return `(no FOMC decision inside the next ${FOMC_WINDOW_DAYS} days)`;
  return upcoming.map((x) => `FOMC decision ${x.d} (${x.days}d away)`).join("\n");
}

/** Flattens finished sections into the editor's input. */
export function formatSectionsForEditor(
  sections: { key: string; headline: string; bullets: string[] }[],
): string {
  return sections
    .map((s) => [`## ${s.key}`, s.headline, ...s.bullets.map((b) => `- ${b}`)].join("\n"))
    .join("\n\n");
}
