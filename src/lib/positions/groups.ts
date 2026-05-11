import type { Position } from "../types";
import type { HeldGroup, HeldGroupKind } from "./types";

// Underlying ticker is the first space-separated token in contractDesc.
// Matches the convention used by findHeldPositions in lib/ibkr/client.ts.
function underlyingOf(p: Position): string {
  return p.contractDesc.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

function dteFromIso(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(iso);
  if (!m) return 0;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // End-of-expiration-day cutoff: subtract 1 ms so a same-day check still
  // returns 0 (= "expiring today") rather than -0/+0 ambiguity.
  return Math.round((target - nowMs) / 86_400_000);
}

// Sign-aware sum of (position * avgCost). For an OPT short (position<0) opened
// for a credit, position*avgCost is negative — flipping the sign gives a
// positive number representing "credit received". For a long opened for a
// debit, position*avgCost is positive — flip to get a negative openCredit
// (a debit). avgCost is already per-contract dollars in IBKR's payload.
function sumOpenCredit(legs: Position[]): number {
  return -legs.reduce((acc, p) => acc + p.position * (p.avgCost ?? 0), 0);
}

// Live close in dollars. Same convention as openCredit: positive = receive cash
// to close, negative = pay cash to close. mktPrice is per-share, multiplier 100.
// The signed sum (+1 long, -1 short) directly yields this:
//   Credit Bull Put closing for $115 debit (long@0.85 / short@2.00):
//     (+1)(0.85)(100) + (-1)(2.00)(100) = 85 − 200 = −115 ⇒ we pay $115. ✓
//   Debit Bull Call closing for $150 receive (long@3.00 / short@1.50):
//     (+1)(3.00)(100) + (-1)(1.50)(100) = 300 − 150 = +150 ⇒ we receive $150. ✓
function sumLiveClose(legs: Position[]): number {
  return legs.reduce((acc, p) => acc + p.position * (p.mktPrice ?? 0) * 100, 0);
}

function sumPnl(legs: Position[]): number {
  return legs.reduce((acc, p) => acc + (p.unrealizedPnl ?? 0), 0);
}

// Sort legs by strike ascending, then by side (C before P, via localeCompare) for deterministic output.
function sortedByStrike(legs: Position[]): Position[] {
  return [...legs].sort((a, b) => {
    const sa = a.strike ?? 0;
    const sb = b.strike ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.putOrCall ?? "").localeCompare(b.putOrCall ?? "");
  });
}

// Detect single-leg / vertical-spread shape. Stock pairing (covered call, CSP)
// is folded in by the caller after this returns.
function classifyOptionLegs(legs: Position[]): HeldGroupKind {
  const sorted = sortedByStrike(legs);
  if (sorted.length === 1) {
    const [a] = sorted;
    if (a.putOrCall === "C" && a.position > 0) return "LONG_CALL";
    if (a.putOrCall === "P" && a.position > 0) return "LONG_PUT";
    if (a.putOrCall === "C" && a.position < 0) return "SHORT_CALL";
    if (a.putOrCall === "P" && a.position < 0) return "SHORT_PUT";
    return "CUSTOM";
  }
  if (sorted.length === 2) {
    const [low, high] = sorted;
    const sameSide = low.putOrCall === high.putOrCall;
    if (!sameSide) return "CUSTOM";
    // Verticals require equal-magnitude opposing positions. Ratio spreads
    // (e.g. +1/-2) fall through to CUSTOM rather than being silently
    // labelled as a vertical with wrong max-profit math.
    if (Math.abs(low.position) !== Math.abs(high.position)) return "CUSTOM";
    if (low.putOrCall === "P") {
      // Two puts. Bull put = +long lower / -short higher. Bear put = +long higher / -short lower.
      if (low.position > 0 && high.position < 0) return "BULL_PUT_SPREAD";
      if (low.position < 0 && high.position > 0) return "BEAR_PUT_SPREAD";
      return "CUSTOM";
    }
    if (low.putOrCall === "C") {
      // Two calls. Bull call (debit) = +long lower / -short higher. Bear call (credit) = -short lower / +long higher.
      if (low.position > 0 && high.position < 0) return "BULL_CALL_SPREAD";
      if (low.position < 0 && high.position > 0) return "BEAR_CALL_SPREAD";
      return "CUSTOM";
    }
  }
  if (sorted.length === 4) {
    // Iron Condor: long put @ K1, short put @ K2, short call @ K3, long call @ K4
    // with K1 < K2 < K3 < K4. All four legs must be the same |quantity|.
    const [a, b, c, d] = sorted;
    const sides = [a.putOrCall, b.putOrCall, c.putOrCall, d.putOrCall];
    if (sides[0] !== "P" || sides[1] !== "P" || sides[2] !== "C" || sides[3] !== "C") {
      return "CUSTOM";
    }
    const qty = Math.abs(a.position);
    if (qty === 0) return "CUSTOM";
    if (
      Math.abs(b.position) !== qty ||
      Math.abs(c.position) !== qty ||
      Math.abs(d.position) !== qty
    ) {
      return "CUSTOM";
    }
    // Direction: long put + short put + short call + long call.
    if (a.position > 0 && b.position < 0 && c.position < 0 && d.position > 0) {
      return "IRON_CONDOR";
    }
    return "CUSTOM";
  }
  return "CUSTOM";
}

// Vertical-spread max profit (debit case). Credit verticals' max profit equals
// openCredit and is handled in triggers.ts. STOCK / singles / CUSTOM return null.
function debitVerticalMaxProfit(kind: HeldGroupKind, legs: Position[], openCredit: number): number | null {
  if (kind !== "BULL_CALL_SPREAD" && kind !== "BEAR_PUT_SPREAD") return null;
  const sorted = sortedByStrike(legs);
  if (sorted.length !== 2) return null;
  const [low, high] = sorted;
  if (low.strike == null || high.strike == null) return null;
  const width = Math.abs(high.strike - low.strike);
  // Per-contract max profit = width * 100 - debit paid. abs(openCredit) is debit
  // when openCredit < 0. Multiply by contracts (= |position| of either leg).
  const contracts = Math.abs(low.position) || Math.abs(high.position) || 1;
  return width * 100 * contracts - Math.abs(openCredit);
}

export interface ClassifyOptions {
  // CSP eligibility: a SHORT_PUT is relabelled CSP iff the strike notional is
  // covered by these dollars. Pass portfolio.summary.totalCash + availableFunds
  // (or any other cash-ish figure) — the function just compares notional ≤ cash.
  cashAvailableForCsp?: number;
  // Now in ms — defaults to Date.now(). Injectable for deterministic tests.
  nowMs?: number;
}

// Classify every position in the portfolio into HeldGroup[]. Stocks come first
// (one group per ticker), then option groups (one per (ticker,expiry) bucket).
export function classifyPortfolio(positions: Position[], opts: ClassifyOptions = {}): HeldGroup[] {
  const nowMs = opts.nowMs ?? Date.now();
  const cashForCsp = opts.cashAvailableForCsp ?? 0;

  // STK rows aggregated per underlying so a user with two AAPL lots shows one
  // STOCK group with the combined position and avg cost.
  const stockByTicker = new Map<string, Position[]>();
  // OPT rows bucketed by (underlying, expiry) so spread detection has the
  // right neighborhood.
  const optByBucket = new Map<string, Position[]>();

  for (const p of positions) {
    const tk = underlyingOf(p);
    if (!tk) continue;
    if (p.assetClass === "STK") {
      const arr = stockByTicker.get(tk) ?? [];
      arr.push(p);
      stockByTicker.set(tk, arr);
    } else if (p.assetClass === "OPT") {
      if (p.position === 0) continue;
      const exp = p.expiry ?? "";
      const key = `${tk}|${exp}`;
      const arr = optByBucket.get(key) ?? [];
      arr.push(p);
      optByBucket.set(key, arr);
    }
  }

  const groups: HeldGroup[] = [];

  // Stocks first.
  for (const [underlying, legs] of stockByTicker) {
    const totalShares = legs.reduce((acc, p) => acc + p.position, 0);
    if (totalShares === 0) continue; // closed position lingering in feed
    groups.push({
      kind: "STOCK",
      underlying,
      expiry: "",
      dte: 0,
      legs,
      openCredit: 0,
      liveClose: 0,
      pnl: sumPnl(legs),
      pnlPctOfMax: null,
      triggers: { pt50Hit: false, dteUnder21: false, stopBreached: false },
      suggestion: "HOLD",
    });
  }

  // Option groups.
  for (const [key, legs] of optByBucket) {
    const [underlying, expiry] = key.split("|");
    const dte = dteFromIso(expiry || null, nowMs);
    let kind = classifyOptionLegs(legs);

    // Stock pairing: SHORT_CALL + ≥100 shares of the underlying → COVERED_CALL.
    if (kind === "SHORT_CALL") {
      const stockLegs = stockByTicker.get(underlying) ?? [];
      const shares = stockLegs.reduce((acc, p) => acc + p.position, 0);
      const contracts = legs.reduce((acc, p) => acc + Math.abs(p.position), 0);
      if (shares >= 100 * contracts) kind = "COVERED_CALL";
    }

    // CSP labelling: SHORT_PUT with cash to back the assignment.
    if (kind === "SHORT_PUT") {
      const sorted = sortedByStrike(legs);
      const [a] = sorted;
      const contracts = Math.abs(a.position);
      const notional = (a.strike ?? 0) * 100 * contracts;
      if (notional > 0 && cashForCsp >= notional) kind = "CSP";
    }

    const openCredit = sumOpenCredit(legs);
    const liveClose = sumLiveClose(legs);
    const pnl = sumPnl(legs);

    let pnlPctOfMax: number | null = null;
    let dataIssue: string | undefined;

    if (dte < 0) {
      dataIssue = "Position past expiry — will be excluded from verdict facts.";
    } else if (kind === "CUSTOM" && legs.length >= 3) {
      dataIssue = "Multi-leg structure not modelled — verdict will skip detailed analysis.";
    }

    if (openCredit > 0) {
      // Credit structures: max profit = openCredit.
      pnlPctOfMax = openCredit > 0 ? pnl / openCredit : null;
    } else if (openCredit < 0) {
      // Debit structures.
      const maxProfit = debitVerticalMaxProfit(kind, legs, openCredit);
      if (maxProfit !== null && maxProfit > 0) {
        pnlPctOfMax = pnl / maxProfit;
      } else if (kind === "LONG_CALL" || kind === "LONG_PUT") {
        // Long single: report against the debit paid (cap at +∞ profit, but
        // for trigger purposes "+50% PT" means current premium ≥ 1.5× cost,
        // i.e. pnl ≥ 0.5 × |openCredit|).
        pnlPctOfMax = pnl / Math.abs(openCredit);
      }
    }

    groups.push({
      kind,
      underlying,
      expiry: expiry || "",
      dte,
      legs,
      openCredit,
      liveClose,
      pnl,
      pnlPctOfMax,
      triggers: { pt50Hit: false, dteUnder21: false, stopBreached: false },
      suggestion: "HOLD",
      ...(dataIssue ? { dataIssue } : {}),
    });
  }

  return groups;
}

// Convenience for the per-ticker detail card. Filters by underlying.
export function groupsForTicker(groups: HeldGroup[], ticker: string): HeldGroup[] {
  const tk = ticker.toUpperCase();
  return groups.filter((g) => g.underlying === tk);
}
