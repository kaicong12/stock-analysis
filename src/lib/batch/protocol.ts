import type {
  HeldGroup,
  PanelSummary,
  Portfolio,
  Position,
  SnapshotResult,
  Verdict,
} from "../types";

export type PanelKey = keyof Verdict["panels"];

export const PANEL_KEYS: PanelKey[] = [
  "fundamentals",
  "capital",
  "technical",
  "derivatives",
  "sentiment",
  "digest",
  "news",
  "insider",
];

// What the Single tab needs to render a ticker without re-fetching anything.
// `portfolio` is hydrated client-side from a separate stream event so the
// payload doesn't redundantly serialize the same portfolio N times.
export interface BatchTickerPayload {
  ticker: string;
  symbol: string;
  snapshot: SnapshotResult;
  portfolio: Portfolio | null;
  heldPositions: Position[];
  heldGroups: HeldGroup[];
  panels: Record<PanelKey, PanelSummary>;
  verdict: Verdict;
  nextEarningsDate: string | null;
}

export type BatchStage = "prep" | "panels" | "verdict" | "done";
export type BatchStatus = "loading" | "done" | "error";

export type BatchEvent =
  | { ticker: string; stage: BatchStage; status: BatchStatus; error?: string; confidence?: number; payload?: BatchTickerPayload }
  | { event: "portfolio"; portfolio: Portfolio | null }
  | { event: "portfolio_error"; error: string }
  | { event: "all_done" };

export function parseTickers(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toUpperCase()),
    ),
  );
}
