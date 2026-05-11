import type { HeldGroup, HeldGroupKind, HeldGroupTriggers, HeldSuggestion } from "./types";

// Which kinds get credit-style triggers (50% PT, 2× SL, 21 DTE) vs
// debit-style triggers (50% PT of max profit, 50% SL of debit, 21 DTE).
function regime(kind: HeldGroupKind): "credit" | "debit" | "covered_call" | "stock" | "custom" {
  switch (kind) {
    case "BULL_PUT_SPREAD":
    case "BEAR_CALL_SPREAD":
    case "CSP":
    case "SHORT_CALL":
    case "SHORT_PUT":
      return "credit";
    case "COVERED_CALL":
      return "covered_call";
    case "BULL_CALL_SPREAD":
    case "BEAR_PUT_SPREAD":
    case "LONG_CALL":
    case "LONG_PUT":
      return "debit";
    case "STOCK":
      return "stock";
    case "CUSTOM":
    default:
      return "custom";
  }
}

// Compute the trigger flags for a group. Pure function over the group's own
// state — does not mutate the input.
export function computeTriggers(g: HeldGroup): HeldGroupTriggers {
  if (g.dte < 0) return { pt50Hit: false, dteUnder21: false, stopBreached: false };
  const dteUnder21 = g.dte <= 21 && g.dte >= 0;
  const r = regime(g.kind);
  if (r === "stock" || r === "custom") {
    return { pt50Hit: false, dteUnder21: false, stopBreached: false };
  }
  if (r === "credit" || r === "covered_call") {
    const credit = Math.abs(g.openCredit);
    const pt50Hit = credit > 0 && g.pnl >= 0.5 * credit;
    const stopBreached = r === "covered_call" ? false : credit > 0 && g.pnl <= -2 * credit;
    return { pt50Hit, dteUnder21, stopBreached };
  }
  // Debit
  const debit = Math.abs(g.openCredit);
  const stopBreached = debit > 0 && g.pnl <= -0.5 * debit;
  // pt50Hit is best expressed via pnlPctOfMax (groups.ts already normalized this).
  const pt50Hit = g.pnlPctOfMax !== null && g.pnlPctOfMax >= 0.5;
  return { pt50Hit, dteUnder21, stopBreached };
}

// Direction-aware roll for a CREDIT structure under stress: bull puts get
// rolled out AND DOWN (away from the threatened lower side); bear calls get
// rolled out AND UP. Singles inherit the same idea.
function rollDirection(kind: HeldGroupKind): HeldSuggestion {
  switch (kind) {
    case "BULL_PUT_SPREAD":
    case "SHORT_PUT":
    case "CSP":
      return "ROLL_OUT_AND_DOWN";
    case "BEAR_CALL_SPREAD":
    case "SHORT_CALL":
    case "COVERED_CALL":
      return "ROLL_OUT_AND_UP";
    default:
      return "ROLL_OUT";
  }
}

// Derive the rule-based suggestion. The verdict LLM still picks the final
// derivatives.action — this is advisory and feeds the synth prompt.
export function computeSuggestion(g: HeldGroup, t: HeldGroupTriggers): HeldSuggestion {
  const r = regime(g.kind);
  if (r === "stock" || r === "custom") return "HOLD";
  if (t.pt50Hit) return "CLOSE";
  if (t.stopBreached) {
    if (r === "credit") return rollDirection(g.kind);
    return "CLOSE"; // debit: cut the loss
  }
  if (t.dteUnder21) {
    if (g.pnl > 0) return "CLOSE"; // take any profit before gamma risk
    if (r === "credit") return "ROLL_OUT"; // same strikes, later expiry
    return "CLOSE"; // debit losing into 21 DTE: cut it
  }
  return "HOLD";
}

// Mutating helper: fill triggers + suggestion on every group in place. Used by
// the prep route after classification.
export function annotateGroups(groups: HeldGroup[]): void {
  for (const g of groups) {
    g.triggers = computeTriggers(g);
    g.suggestion = computeSuggestion(g, g.triggers);
  }
}
