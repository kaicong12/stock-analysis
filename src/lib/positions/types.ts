import type { Position } from "../types";

export type HeldGroupKind =
  | "BULL_PUT_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "BULL_CALL_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "IRON_CONDOR"
  | "COVERED_CALL"
  | "CSP"
  | "LONG_CALL"
  | "LONG_PUT"
  | "SHORT_CALL"
  | "SHORT_PUT"
  | "STOCK"
  | "CUSTOM";

export type HeldSuggestion =
  | "HOLD"
  | "CLOSE"
  | "ROLL_OUT"
  | "ROLL_OUT_AND_DOWN"
  | "ROLL_OUT_AND_UP";

export interface HeldGroupTriggers {
  pt50Hit: boolean;
  dteUnder21: boolean;
  stopBreached: boolean;
}

// One STK/OPT group: a stock line, a single option leg, a vertical spread,
// a covered call, etc. Detected deterministically from a Portfolio's positions.
export interface HeldGroup {
  kind: HeldGroupKind;
  underlying: string;        // e.g. "AAPL"
  expiry: string;            // ISO YYYY-MM-DD; "" for STOCK or multi-expiry CUSTOM
  dte: number;               // 0 for stock-only; can be negative if expired-but-not-cleared
  legs: Position[];          // raw legs that compose this group
  // Open-cost basis in dollars for the package as a whole.
  // Positive = credit received on open. Negative = debit paid on open.
  // For STOCK groups, this is 0 (no premium concept); cost basis lives in legs.
  openCredit: number;
  // Live close in dollars. Positive = receive cash to close. Negative = pay cash to close.
  // For STOCK groups, this is 0; the unrealized P/L is in `pnl`.
  liveClose: number;
  pnl: number;               // unrealized $ P/L (sum of leg.unrealizedPnl)
  // P/L as a fraction of the structure's max profit (credits) or |openCredit| (debits).
  // null for STOCK / CUSTOM / when max profit isn't well-defined.
  pnlPctOfMax: number | null;
  // Set on detection (groups.ts); zero/false defaults until triggers.ts fills them in.
  triggers: HeldGroupTriggers;
  suggestion: HeldSuggestion;
  // Set only for CUSTOM groups dropped because of bad data (e.g. expired but not
  // cleared from the portfolio). UI shows a small flag; verdict prompt skips them.
  dataIssue?: string;
}

// Convenience predicate: groups where structural triggers + suggestion are meaningful.
export function isOptionGroup(g: HeldGroup): boolean {
  return g.kind !== "STOCK";
}
