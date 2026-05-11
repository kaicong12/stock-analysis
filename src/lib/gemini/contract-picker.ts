// Contract picker — turns a derivatives-sleeve action (e.g. BUY_CALL_SPREAD)
// + the live option chain + portfolio context into a concrete ContractPick:
// specific contract codes, limit price, sized contracts, max P/L, breakeven.

import { genJson } from "./client";
import type {
  ContractLeg,
  ContractPick,
  DerivativesAction,
  OptionChain,
  OptionContract,
  Portfolio,
  Position,
  RollPlan,
  SleeveDirection,
} from "../types";

// ---------- schema ----------

const LEG_SCHEMA = {
  type: "object",
  properties: {
    contract: { type: "string" },
    description: { type: "string" },
    side: { type: "string", enum: ["C", "P"] },
    strike: { type: "number" },
    expiry: { type: "string" },
    last: { type: ["number", "null"] },
    iv: { type: ["number", "null"] },
    delta: { type: ["number", "null"] },
    theta: { type: ["number", "null"] },
    vega: { type: ["number", "null"] },
  },
  required: ["contract", "description", "side", "strike", "expiry"],
};

const ROLL_PLAN_SCHEMA = {
  type: "object",
  properties: {
    openingLegs: { type: "array", items: LEG_SCHEMA, minItems: 1, maxItems: 2 },
    openingCredit: { type: "number" },
    newMaxLoss: { type: "number" },
    newMaxProfit: { type: "number" },
    newBreakeven: { type: "number" },
  },
  required: ["openingLegs", "openingCredit", "newMaxLoss", "newMaxProfit", "newBreakeven"],
};

const PICK_SCHEMA = {
  type: "object",
  properties: {
    strategy: {
      type: "string",
      enum: [
        "BUY_CALL_SPREAD",
        "BUY_PUT_SPREAD",
        "SELL_PUT_SPREAD",
        "SELL_CALL_SPREAD",
        "SELL_COVERED_CALL",
        "SELL_CASH_SECURED_PUT",
        "IRON_CONDOR",
        "ROLL_OUT",
      ],
    },
    longLeg: LEG_SCHEMA,
    shortLeg: LEG_SCHEMA,
    longPutLeg: LEG_SCHEMA,
    shortPutLeg: LEG_SCHEMA,
    shortCallLeg: LEG_SCHEMA,
    longCallLeg: LEG_SCHEMA,
    netDebit: { type: "number" },
    netCredit: { type: "number" },
    rollPlan: ROLL_PLAN_SCHEMA,
    limitPrice: { type: "number" },
    maxProfit: { type: "number" },
    maxLoss: { type: "number" },
    breakeven: { type: "number" },
    breakevenLower: { type: "number" },
    breakevenUpper: { type: "number" },
    suggestedContracts: { type: "integer", minimum: 1 },
    capitalRequired: { type: "number" },
    ivPercentileNote: { type: "string" },
    rationale: { type: "string" },
  },
  required: [
    "strategy",
    "limitPrice",
    "maxProfit",
    "maxLoss",
    "breakeven",
    "suggestedContracts",
    "capitalRequired",
    "ivPercentileNote",
    "rationale",
  ],
};

// ---------- system instruction ----------

const SYSTEM_INSTRUCTION = `You are the options-execution analyst at the desk. The head PM has issued a derivatives sleeve action (one of: BUY_CALL_SPREAD, BUY_PUT_SPREAD, SELL_COVERED_CALL, SELL_CASH_SECURED_PUT). Your job: pick a SPECIFIC pair of contracts (or single contract for income trades) from the live option chain, set a limit price, and size the trade against the user's NAV.

Data source — IBKR Client Portal snapshot (real-time during RTH, last-close otherwise):
- delta / gamma / theta / vega ARE provided. Use them. Treat |delta| as the primary moneyness handle:
  - "ATM call/put" = |delta| ≈ 0.45-0.55.
  - "1 strike ITM" = |delta| ≈ 0.55-0.65.
  - "30-delta OTM" = |delta| ≈ 0.25-0.35.
- iv (option-level implied vol %), oi, volume, last, bid, ask are also provided. If volume / oi / iv come back null on a contract (common outside RTH or for very-far-OTM strikes), fall back to strike-vs-spot moneyness for that one contract.
- Use bid/ask midpoint when both are present; fall back to "last" otherwise.

Universal rules:
- Target 30–45 DTE. If multiple expiries qualify, prefer the one with the deepest open interest near your chosen strikes.
- Liquidity gate — skip a contract if ANY of: bid == null AND last == null; oi < 50 (when oi is provided); (ask − bid) / mid > 0.10 (spread > 10% of mid is a no-fill risk).
- Limit price = bid/ask midpoint when both legs have quotes; for spreads, limitPrice = long.mid − short.mid (net debit). For income trades, limitPrice = short.mid (credit). Fall back to "last" if a quote is missing.
- Sizing must respect NAV. For BUY spreads: cap max-loss-at-trade ≤ 0.5% NAV. For SELL income: cap notional exposure (strike × 100 × contracts) ≤ available cash for CSP, ≤ held shares for covered call.
- Profit-take discipline (CREDIT trades — covered call, CSP, credit spread, ROLL_OUT): always include a 50%-of-max profit-take target in the rationale, expressed as the "close at $X" price. Example: "sell at $2.00 credit, close at $1.00 (50% max)". Reason: gamma risk + IV-expansion risk dominate the second half of theta payoff; recycling capital into a fresh 30-45 DTE trade beats squeezing the last 50%. For DEBIT spreads, include a 50-75%-of-max profit-take in the rationale instead — debits don't have the same gamma penalty but should still be closed before they decay back to zero.

Strategy-specific rules:

BUY_CALL_SPREAD (bullish debit):
- Long leg by delta: ATM (Δ 0.45-0.55) for default; 1-strike-ITM (Δ 0.55-0.65) when confidence ≥ 80 (more intrinsic, less time-value bleed). Reject if Δ unavailable for the candidate AND the strike-vs-spot proxy is outside ±2% of spot.
- Short leg by delta: ~30-delta OTM (Δ 0.20-0.35). Lower delta = wider, cheaper, lower probability; higher delta = tighter, richer, higher probability.
- Spread WIDTH (in strikes) is confidence-scaled: <65 → 1; 65–74 → 2; 75–84 → 3; ≥85 → 4–5. Use this to pick which OTM short leg satisfies the delta range.
- Prefer LOW vega when buying spreads in elevated IV (you're not trying to be long vol). When IV is depressed, vega exposure is acceptable.
- netDebit = long.mid − short.mid; maxProfit = (shortStrike − longStrike) × 100 − netDebit × 100; maxLoss = netDebit × 100; breakeven = longStrike + netDebit.

BUY_PUT_SPREAD (bearish debit): mirror of above using puts. Long Δ between -0.45 and -0.55 default, -0.55 to -0.65 when confidence ≥ 80; short ~30-delta OTM put (Δ between -0.20 and -0.35). Same width scaling, same vega preference.

SELL_PUT_SPREAD (bullish CREDIT — bull put spread; the cash-light alternative to SELL_CASH_SECURED_PUT):
- Short leg by delta: DEFAULT to Δ between -0.15 and -0.20 (further OTM, higher POP, more cushion below spot — the conservative default). Step tighter (Δ -0.20 to -0.25) ONLY when confidence ≥ 75 AND a real technical support level mentioned in the technical panel sits at or above the chosen strike. Tighter still (Δ -0.25 to -0.30) ONLY when confidence ≥ 80 AND willing to manage. NEVER pick Δ beyond -0.30 by default — that is a managed-risk trade, not a passive credit harvest.
- Long leg: protective put 5-10 strikes BELOW the short put, sized so width × 100 fits sizing (NEAR 5 wide for stocks $50-200, 10 wide for $200-500, 20 wide for $500+).
- Strike selection: short strike near a real support level mentioned in the technical panel; long strike just defines the max loss.
- Prefer HIGH theta (faster decay) and HIGH IV percentile (richer credit) on the short leg. If two strikes have similar delta, pick larger |theta|.
- Width scaling by NAV: keep max-loss-per-contract ≤ 0.5% of NAV. So if NAV is $50k, max loss/contract ≤ $250 → 5-wide spread max ($500 width − ~$150 credit = ~$350 BPR is fine for $100k NAV but too wide for $20k).
- Contracts: scale by confidence and NAV, default 3-5; cap so total max loss ≤ 1.5% of NAV.
- netCredit = short.mid − long.mid; limitPrice = netCredit (positive = receive); maxProfit = netCredit × 100 × contracts; maxLoss = (width × 100 − netCredit × 100) × contracts; breakeven = shortStrike − netCredit; capitalRequired = maxLoss (defined risk = BPR for cash accounts; less for margin).
- Rationale must include: short Δ, both strikes, net credit, 50%-of-max profit-take target ("close at $X = 50% max"), and the BPR vs. CSP equivalent (e.g. "BPR ~$350/contract vs. ~$18,000 for CSP at same strike").

SELL_CALL_SPREAD (bearish CREDIT — bear call spread; the no-shares alternative to SELL_COVERED_CALL):
- Short leg by delta: DEFAULT to Δ between 0.15 and 0.20 (further OTM, higher POP, more cushion above spot — the conservative default). Step tighter (Δ 0.20 to 0.25) ONLY when confidence ≥ 75 AND a real technical resistance level mentioned in the technical panel sits at or below the chosen strike. Tighter still (Δ 0.25 to 0.30) ONLY when confidence ≥ 80 AND willing to manage. NEVER pick Δ beyond 0.30 by default. Strike must always be ABOVE current spot.
- Long leg: protective call 5-10 strikes ABOVE the short call (same width-scaling as bull put spread).
- Width scaling, theta/IV preference, sizing: identical rules to SELL_PUT_SPREAD above, mirror direction.
- netCredit = short.mid − long.mid; limitPrice = netCredit; maxProfit = netCredit × 100 × contracts; maxLoss = (width × 100 − netCredit × 100) × contracts; breakeven = shortStrike + netCredit; capitalRequired = maxLoss.
- Rationale: short Δ, both strikes, net credit, 50%-of-max profit-take, BPR vs. covered-call equivalent ("BPR ~$350/contract vs. ~$18,000 of stock for covered call").

IRON_CONDOR (neutral CREDIT — bull put spread + bear call spread, same expiry):
- Pick FOUR contracts at the SAME expiry (30-45 DTE):
  - Short put leg: Δ between -0.15 and -0.20 (further-OTM put, the conservative default).
  - Long put leg: protective put 5-10 strikes BELOW the short put.
  - Short call leg: Δ between 0.15 and 0.20 (further-OTM call).
  - Long call leg: protective call 5-10 strikes ABOVE the short call.
- WINGS MUST BE SYMMETRIC: same width on the put side and call side (e.g. 5 wide put + 5 wide call). If chain liquidity forces asymmetry, prefer the wider side on whichever wing has the lower IV (cheaper protective leg).
- Width scaling: stocks $50-200 → 5 wide; $200-500 → 10 wide; $500+ → 20 wide. Same as the single credit spreads.
- Output the four legs in the dedicated fields: longPutLeg + shortPutLeg + shortCallLeg + longCallLeg. Leave longLeg / shortLeg null.
- netCredit = (shortPut.mid − longPut.mid) + (shortCall.mid − longCall.mid). limitPrice = netCredit (positive = receive).
- Economics: maxProfit = netCredit × 100 × contracts; maxLoss = (max(putWidth, callWidth) × 100 − netCredit × 100) × contracts (only one wing can be lost at expiry, so the wider wing dominates); breakevenLower = shortPutStrike − netCredit; breakevenUpper = shortCallStrike + netCredit; capitalRequired = maxLoss; breakeven (the legacy single-value field) = breakevenUpper for UI compatibility.
- Profit-take target: 50% of net credit (same discipline as single credit spreads). Cite the close-at price in the rationale.
- Rationale must include: BOTH short Δ values, all four strikes, net credit, both breakevens, and call out the IV-HV premium on BOTH wings (this is the gating condition).
- Do NOT pick IRON_CONDOR if direction != "neutral" — return a single credit spread instead.

SELL_COVERED_CALL (income on held stock):
- Single leg by delta: DEFAULT to Δ 0.15-0.20 (further OTM, prioritize keeping the shares — the conservative default; income is the bonus, not the goal). Step tighter (Δ 0.20-0.25) ONLY when confidence ≥ 75 with named overhead resistance at or below the chosen strike. Δ 0.25-0.35 is the assignment-friendly mode — pick ONLY when the user has explicitly signaled they're happy to be called away at the strike (e.g. trimming a winner). NEVER pick Δ beyond 0.35 by default.
- Strike MUST be above the user's stock cost basis (no forced loss on assignment).
- Prefer HIGH theta (faster premium decay) and HIGH IV percentile (selling rich vol). If two candidate strikes have similar delta, pick the one with the larger |theta|.
- Contracts = floor(UNCOVERED shares / 100). Inspect heldOptionLegs for existing short calls on this ticker — subtract their absolute quantity from heldStockShares before dividing, so you never stack a covered call on top of one already overwriting those shares.
- netCredit = short.mid; limitPrice = short.mid; maxProfit = netCredit × 100 + (strike − costBasis) × 100 (if assigned); maxLoss capped at the stock's downside below cost basis; breakeven = costBasis − netCredit.

SELL_CASH_SECURED_PUT (income / get-assigned-cheap):
- Single leg by delta: DEFAULT to Δ between -0.15 and -0.20 (further OTM, higher POP, low assignment probability — the conservative default; the goal is income at a discount, not assignment). Step tighter (Δ -0.20 to -0.25) ONLY when a real support level at or above the chosen strike is named in the technical panel. Δ -0.25 to -0.35 is the assignment-friendly mode — pick ONLY when the user has explicitly signaled they'd be happy to own at the strike AND confidence ≥ 80. NEVER pick Δ beyond -0.35 by default.
- Strike at a price you'd be happy to own — at or below current spot, ideally near a support level mentioned in the technical panel.
- Same theta/IV preference as covered calls: pick HIGH theta + HIGH IV percentile when two strikes are otherwise comparable.
- Contracts: assume cash is available (user tops up). Default 3-5 contracts; scale by confidence (high conf → up to 10 contracts).
- capitalRequired = strike × 100 × contracts.
- netCredit = short.mid; limitPrice = short.mid; maxProfit = netCredit × 100; maxLoss = (strike − netCredit) × 100 (if assigned and stock goes to zero); breakeven = strike − netCredit.

ROLL_OUT (defensive — close held legs, open later-expiry replacements for net credit):
- The user's heldOptionLegs are the legs you're rolling out of. The server pre-computes closingCostEstimate (USD total to close every held leg) — that's the debit you must overcome with new opening credit.
- Pick opening legs (1 or 2) FROM THE CHAIN at LATER expiry than the most-distant held leg. Target +30 to +60 DTE from today; minimum +21 days from the held leg's expiry.
- rollHint (server-computed from the rule-based suggestion on the held group) takes priority when present:
  - rollHint = "OUT_AND_DOWN" — pick a NEW short-put strike at least 5% LOWER than the held short strike, expiry 45-60 DTE. Defensive widening for a bull put / CSP / short put against the user.
  - rollHint = "OUT_AND_UP" — pick a NEW short-call strike at least 5% HIGHER than the held short strike, expiry 45-60 DTE. Defensive widening for a bear call / covered call / short call against the user.
  - rollHint = "OUT" or null — same short strike (or as close as the chain permits), later expiry, prioritize net-credit roll.
- Direction-aware strike adjustment:
  - Defending a SHORT PUT (or bull put spread): NEW short put strike must be LOWER than the held short put strike (down-and-out), at Δ -0.20 to -0.30. New long put strike preserves the original spread WIDTH (e.g. held 480/475 spread → new 470/465).
  - Defending a SHORT CALL (or bear call spread): NEW short call strike must be HIGHER than the held short call strike (up-and-out), at Δ 0.20 to 0.30.
  - Defending a CSP that's gone ITM but no spread context: same rules — lower strike, longer expiry.
- HARD CONSTRAINT: openingCredit (in $, total per contract × 100) MUST be ≥ closingCostEstimate. If you cannot find a candidate where this holds, still output your best pick but explicitly call it a DEBIT roll in the rationale — the verdict stage prefers CLOSE over a debit roll.
- openingCredit calculation:
  - Spread (2 opening legs): openingCredit = (short.mid − long.mid) × 100 × suggestedContracts.
  - Single leg (covered call / CSP roll): openingCredit = short.mid × 100 × suggestedContracts.
- Economics on the NEW structure (use these as rollPlan.newMaxLoss / newMaxProfit / newBreakeven):
  - Net roll credit (for rationale) = openingCredit − closingCostEstimate.
  - For a credit spread roll: newMaxLoss = (width × 100 × contracts) − netRollCredit; newMaxProfit = netRollCredit; newBreakeven = newShortStrike − (netRollCredit / 100 / contracts).
  - For a single-leg short roll: newMaxLoss = (newStrike × 100 × contracts) − netRollCredit (assumes assignment + worst case); newMaxProfit = netRollCredit; newBreakeven = newStrike − (netRollCredit / 100 / contracts).
- suggestedContracts = match the held leg quantity exactly (rolling preserves size).
- limitPrice = the OPENING package's per-contract net credit (positive number, e.g. 3.00). The closing legs are filled by the server at market — do NOT include them in your rollPlan output.
- maxProfit / maxLoss / breakeven (top-level) MIRROR rollPlan.newMaxProfit / newMaxLoss / newBreakeven so the existing UI metrics still work.
- capitalRequired = rollPlan.newMaxLoss (defined-risk).
- ivPercentileNote: read of the new opening expiry's near-ATM IV.
- rationale: cite (a) held leg's current Δ + DTE, (b) new short strike + Δ + new expiry, (c) opening credit + closing cost + net roll credit. Example: "Held 480 short put now Δ -0.55 with 14 DTE; rolling down-and-out to 470/465 30-Jun (Δ -0.27) for $3.00 credit, closes $2.50 → net +$50/contract, +44 DTE of breathing room."
- Output ONLY rollPlan + the top-level economics fields. Do NOT populate longLeg / shortLeg / netDebit / netCredit for ROLL_OUT.

ivPercentileNote: a one-line read of the IV regime using near-ATM IV from the chain, anchored to the name's historical range. Tag the vega regime explicitly: "Near-ATM IV ~32% — LOW; long-vega debit spreads favored" or "ATM IV 78% — HIGH; short-vega credit trades favored, IV crush risk on debits."

Probability of Profit (POP) heuristic — include in the rationale:
- For SHORT options (legs you sell), POP at expiration ≈ 1 − |delta|. A short put at Δ -0.30 has ~70% POP; a short call at Δ 0.20 has ~80% POP.
- For DEBIT spreads, POP ≈ 1 − |delta of long leg| as a rough lower bound; typical is 30-45%.
- Mention the POP in the rationale ("CSP at Δ -0.28 ≈ 72% POP at expiry").

rationale: 1-2 sentences. Cite the specific strike + expiry + delta + IV (and theta/vega when they drove the call) + estimated POP, and tie back to the directional thesis. Example: "Bullish conf 72 + ATM IV 78% (HIGH) → SELL_CSP at 30-DTE Δ -0.28 put; collect $4.20 credit, ~72% POP, short-vega plays the IV crush."

Output ONLY the strategy you were asked for. Do NOT output a different strategy than the input action.

Use ONLY contract codes that appear verbatim in the chain payload — do NOT invent or rewrite contract codes.

For longLeg / shortLeg, you only need to set: contract (the OCC code from the chain), description (human-readable e.g. "TSLA 2026-05-29 380 Call"), side, strike, expiry. The numeric fields (iv, delta, theta, vega, last, bid, ask) will be populated from the chain by the data layer — you can leave them null in your output, but be aware they WILL be filled in for the rationale you write, so cite the chain's actual delta/IV when writing rationale.`;

// ---------- input shaping ----------

export interface PickerInput {
  ticker: string;
  symbol: string;
  spot: number;
  derivativesAction: DerivativesAction;
  direction: SleeveDirection;
  confidence: number;
  chain: OptionChain;
  portfolio: Portfolio | null;
  heldPositions: Position[];
  // Optional defensive-roll geometry hint, derived from the held group's
  // rule-based suggestion. The picker biases new-leg strike selection
  // accordingly; ignored for non-ROLL_OUT actions.
  rollHint?: "OUT" | "OUT_AND_DOWN" | "OUT_AND_UP";
}

// Compress chain to keep prompt small but keep all the data the picker needs.
function compressChain(chain: OptionChain) {
  return {
    spot: chain.spot,
    expiries: chain.expiries.map((e) => ({
      expiry: e.expiry,
      dte: e.dte,
      contracts: e.contracts.map((c) => ({
        code: c.code,
        side: c.side,
        strike: c.strike,
        last: c.last,
        bid: c.bid,
        ask: c.ask,
        iv: c.iv,
        delta: c.delta,
        theta: c.theta,
        vega: c.vega,
        oi: c.oi,
        volume: c.volume,
      })),
    })),
  };
}

function buildPrompt(input: PickerInput): string {
  const stockRows = input.heldPositions.filter((p) => p.assetClass === "STK");
  const heldStockShares = stockRows.reduce((acc, p) => acc + Math.max(0, p.position), 0);
  const heldStockCostBasis = heldStockShares > 0
    ? stockRows.reduce((acc, p) => acc + p.avgCost * Math.max(0, p.position), 0) / heldStockShares
    : null;

  const optionLegs = input.heldPositions.filter((p) => p.assetClass === "OPT");

  const payload = {
    ticker: input.ticker,
    symbol: input.symbol,
    spot: input.spot,
    derivativesAction: input.derivativesAction,
    direction: input.direction,
    confidence: input.confidence,
    rollHint: input.rollHint ?? null,
    portfolio: input.portfolio && {
      netLiquidationSGD: input.portfolio.summary.netLiquidation,
      availableFundsSGD: input.portfolio.summary.availableFunds,
      buyingPowerSGD: input.portfolio.summary.buyingPower,
      baseCurrency: input.portfolio.baseCurrency,
    },
    heldStock: heldStockShares > 0 ? {
      shares: heldStockShares,
      avgCost: heldStockCostBasis,
    } : null,
    heldOptionLegs: optionLegs.map((p) => ({
      contractDesc: p.contractDesc,
      side: p.position > 0 ? "LONG" : "SHORT",
      quantity: p.position,
      strike: p.strike,
      right: p.putOrCall,
      expiry: p.expiry,
      avgCost: p.avgCost,
      mktPrice: p.mktPrice,
      liveGreeks: p.liveGreeks ?? null,
    })),
    // Server-computed estimate of $ cost to close ALL held option legs at
    // current mktPrice. Only meaningful for ROLL_OUT — the picker uses this
    // as the hard floor that openingCredit must clear.
    closingCostEstimate: input.derivativesAction === "ROLL_OUT"
      ? Number(closingCostEstimate(optionLegs).toFixed(2))
      : null,
    chain: compressChain(input.chain),
  };

  return [
    `Pick a contract for ${input.ticker} per strategy "${input.derivativesAction}".`,
    "",
    "Context:",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "Return one ContractPick per schema. Use ONLY contract codes that appear verbatim in the chain above.",
  ].join("\n");
}

// ---------- entry point ----------

interface RawRollPlan {
  openingLegs: ContractLeg[];
  openingCredit: number;
  newMaxLoss: number;
  newMaxProfit: number;
  newBreakeven: number;
}

interface RawPick {
  strategy: ContractPick["strategy"];
  longLeg?: ContractLeg;
  shortLeg?: ContractLeg;
  longPutLeg?: ContractLeg;
  shortPutLeg?: ContractLeg;
  shortCallLeg?: ContractLeg;
  longCallLeg?: ContractLeg;
  netDebit?: number;
  netCredit?: number;
  rollPlan?: RawRollPlan;
  limitPrice: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  breakevenLower?: number;
  breakevenUpper?: number;
  suggestedContracts: number;
  capitalRequired: number;
  ivPercentileNote: string;
  rationale: string;
}

function pickerEligible(action: DerivativesAction): action is ContractPick["strategy"] {
  return (
    action === "BUY_CALL_SPREAD" ||
    action === "BUY_PUT_SPREAD" ||
    action === "SELL_PUT_SPREAD" ||
    action === "SELL_CALL_SPREAD" ||
    action === "SELL_COVERED_CALL" ||
    action === "SELL_CASH_SECURED_PUT" ||
    action === "IRON_CONDOR" ||
    action === "ROLL_OUT"
  );
}

// Compute the per-position $ cost to close every held option leg. Sign convention:
// closing a SHORT (position<0) means buying it back → we pay mktPrice (positive
// cost); closing a LONG (position>0) means selling it → we receive mktPrice
// (negative cost). Total = -100 × Σ(position × mktPrice) per US-equity options
// multiplier convention.
function closingCostEstimate(positions: Position[]): number {
  return positions
    .filter((p) => p.assetClass === "OPT")
    .reduce((acc, p) => acc + -1 * p.position * (p.mktPrice ?? 0) * 100, 0);
}

// Build a ContractLeg representation of a held option position. Used for the
// closingLegs array on RollPlan — the server fills these in deterministically
// from heldPositions, so the model only ever picks the OPENING legs.
function buildClosingLeg(p: Position): ContractLeg | null {
  if (p.assetClass !== "OPT") return null;
  if (p.strike == null || !p.putOrCall || !p.expiry) return null;
  const right: "C" | "P" = p.putOrCall === "C" || p.putOrCall === "P" ? p.putOrCall : "C";
  return {
    contract: p.contractDesc,
    description: p.contractDesc,
    side: right,
    strike: p.strike,
    expiry: p.expiry,
    last: p.mktPrice ?? null,
    iv: p.liveGreeks?.iv ?? null,
    delta: p.liveGreeks?.delta ?? null,
    theta: p.liveGreeks?.theta ?? null,
    vega: p.liveGreeks?.vega ?? null,
    conid: p.conid,
    ratio: p.position > 0 ? -1 : 1, // To close: if held long (>0), sell (-1). If held short (<0), buy (+1).
  };
}

// Resolve a leg's chain entry by OCC code so we can read live bid/ask/last.
function lookupChainContract(
  leg: ContractLeg | undefined,
  chain: OptionChain,
): OptionContract | null {
  if (!leg?.contract) return null;
  for (const exp of chain.expiries) {
    const m = exp.contracts.find((c) => c.code === leg.contract);
    if (m) return m;
  }
  return null;
}

// Executable mid: bid/ask midpoint when both present, otherwise the available
// quote, otherwise last. Mirrors the picker prompt's pricing convention so the
// math the user sees matches what an order would actually fill at.
function executablePrice(c: OptionContract | null): number | null {
  if (!c) return null;
  const hasBid = c.bid != null && c.bid > 0;
  const hasAsk = c.ask != null && c.ask > 0;
  if (hasBid && hasAsk) return ((c.bid as number) + (c.ask as number)) / 2;
  if (hasBid) return c.bid;
  if (hasAsk) return c.ask;
  return c.last;
}

const round2 = (n: number) => Number(n.toFixed(2));
const round0 = (n: number) => Math.round(n);

// Deterministic economics for new-entry strategies. The LLM picks contract
// codes; the server computes credit/debit, max P/L, breakeven, and capital
// from chain truth. ROLL_OUT has its own economics path elsewhere in this
// file. All money fields are TOTAL (× 100 × contracts) for consistency with
// the synth instruction. limitPrice and breakeven remain per-share.
//
// Returns null when prices are unavailable for required legs — caller falls
// back to the LLM's numbers in that (rare) case rather than fabricate.
interface EntryEconomics {
  limitPrice: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  breakevenLower?: number;
  breakevenUpper?: number;
  capitalRequired: number;
  netDebit?: number;
  netCredit?: number;
}

function computeEntryEconomics(
  strategy: ContractPick["strategy"],
  longLeg: ContractLeg | undefined,
  shortLeg: ContractLeg | undefined,
  chain: OptionChain,
  contracts: number,
  costBasis: number | null,
  ironCondorLegs?: {
    longPut: ContractLeg | undefined;
    shortPut: ContractLeg | undefined;
    shortCall: ContractLeg | undefined;
    longCall: ContractLeg | undefined;
  },
): EntryEconomics | null {
  const N = Math.max(1, Math.floor(contracts));
  const longMid = executablePrice(lookupChainContract(longLeg, chain));
  const shortMid = executablePrice(lookupChainContract(shortLeg, chain));

  switch (strategy) {
    case "BUY_CALL_SPREAD":
    case "BUY_PUT_SPREAD": {
      if (!longLeg || !shortLeg || longMid == null || shortMid == null) return null;
      const netDebit = longMid - shortMid;
      const width = Math.abs(longLeg.strike - shortLeg.strike);
      const maxProfit = (width - netDebit) * 100 * N;
      const maxLoss = netDebit * 100 * N;
      const breakeven = strategy === "BUY_CALL_SPREAD"
        ? longLeg.strike + netDebit
        : longLeg.strike - netDebit;
      return {
        limitPrice: round2(netDebit),
        netDebit: round2(netDebit),
        maxProfit: round0(maxProfit),
        maxLoss: round0(maxLoss),
        breakeven: round2(breakeven),
        capitalRequired: round0(maxLoss),
      };
    }
    case "SELL_PUT_SPREAD":
    case "SELL_CALL_SPREAD": {
      if (!longLeg || !shortLeg || longMid == null || shortMid == null) return null;
      const netCredit = shortMid - longMid;
      const width = Math.abs(shortLeg.strike - longLeg.strike);
      const maxProfit = netCredit * 100 * N;
      const maxLoss = (width - netCredit) * 100 * N;
      const breakeven = strategy === "SELL_PUT_SPREAD"
        ? shortLeg.strike - netCredit
        : shortLeg.strike + netCredit;
      return {
        limitPrice: round2(netCredit),
        netCredit: round2(netCredit),
        maxProfit: round0(maxProfit),
        maxLoss: round0(maxLoss),
        breakeven: round2(breakeven),
        capitalRequired: round0(maxLoss),
      };
    }
    case "SELL_CASH_SECURED_PUT": {
      if (!shortLeg || shortMid == null) return null;
      const netCredit = shortMid;
      const maxProfit = netCredit * 100 * N;
      const maxLoss = (shortLeg.strike - netCredit) * 100 * N;
      const breakeven = shortLeg.strike - netCredit;
      const capitalRequired = shortLeg.strike * 100 * N;
      return {
        limitPrice: round2(netCredit),
        netCredit: round2(netCredit),
        maxProfit: round0(maxProfit),
        maxLoss: round0(maxLoss),
        breakeven: round2(breakeven),
        capitalRequired: round0(capitalRequired),
      };
    }
    case "SELL_COVERED_CALL": {
      if (!shortLeg || shortMid == null) return null;
      const netCredit = shortMid;
      const upside = costBasis != null ? Math.max(0, shortLeg.strike - costBasis) : 0;
      const maxProfit = (netCredit + upside) * 100 * N;
      // Theoretical max loss is "stock to zero minus credit collected"; capped
      // at cost basis. When cost basis is unknown we can't compute it honestly,
      // so leave it at 0 rather than mislead.
      const maxLoss = costBasis != null ? Math.max(0, (costBasis - netCredit) * 100 * N) : 0;
      const breakeven = costBasis != null ? costBasis - netCredit : shortLeg.strike - netCredit;
      // Capital is the share notional already deployed; no incremental capital
      // is reserved for the call leg itself.
      return {
        limitPrice: round2(netCredit),
        netCredit: round2(netCredit),
        maxProfit: round0(maxProfit),
        maxLoss: round0(maxLoss),
        breakeven: round2(breakeven),
        capitalRequired: 0,
      };
    }
    case "IRON_CONDOR": {
      if (!ironCondorLegs) return null;
      const { longPut, shortPut, shortCall, longCall } = ironCondorLegs;
      if (!longPut || !shortPut || !shortCall || !longCall) return null;
      const longPutMid = executablePrice(lookupChainContract(longPut, chain));
      const shortPutMid = executablePrice(lookupChainContract(shortPut, chain));
      const shortCallMid = executablePrice(lookupChainContract(shortCall, chain));
      const longCallMid = executablePrice(lookupChainContract(longCall, chain));
      if (
        longPutMid == null ||
        shortPutMid == null ||
        shortCallMid == null ||
        longCallMid == null
      ) {
        return null;
      }
      const netCredit = (shortPutMid - longPutMid) + (shortCallMid - longCallMid);
      const putWidth = Math.abs(shortPut.strike - longPut.strike);
      const callWidth = Math.abs(longCall.strike - shortCall.strike);
      const widerWing = Math.max(putWidth, callWidth);
      const maxProfit = netCredit * 100 * N;
      const maxLoss = (widerWing - netCredit) * 100 * N;
      const breakevenLower = shortPut.strike - netCredit;
      const breakevenUpper = shortCall.strike + netCredit;
      return {
        limitPrice: round2(netCredit),
        netCredit: round2(netCredit),
        maxProfit: round0(maxProfit),
        maxLoss: round0(maxLoss),
        breakeven: round2(breakevenUpper),
        breakevenLower: round2(breakevenLower),
        breakevenUpper: round2(breakevenUpper),
        capitalRequired: round0(maxLoss),
      };
    }
    default:
      return null;
  }
}

// Look up the chain contract that matches a leg's `contract` code (OCC-style)
// and overwrite the leg's numeric fields with what the chain actually has.
// We don't trust the LLM to echo numbers verbatim; this guarantees the UI
// shows real Greeks/quotes, not the model's guess.
function fillLegFromChain(leg: ContractLeg | undefined, chain: OptionChain): ContractLeg | undefined {
  if (!leg?.contract) return leg;
  for (const exp of chain.expiries) {
    const match = exp.contracts.find((c) => c.code === leg.contract);
    if (!match) continue;
    return {
      ...leg,
      strike: match.strike,
      expiry: exp.expiry,
      side: match.side,
      last: match.last,
      iv: match.iv,
      delta: match.delta,
      theta: match.theta,
      vega: match.vega,
      conid: match.conid,
      ratio: leg.ratio,
    };
  }
  return leg;
}

export async function pickContract(input: PickerInput): Promise<ContractPick | null> {
  if (!pickerEligible(input.derivativesAction)) return null;
  if (!input.chain.expiries.length) return null;
  // ROLL_OUT requires existing held legs to roll out of — no legs, nothing to roll.
  if (input.derivativesAction === "ROLL_OUT") {
    const optLegs = input.heldPositions.filter((p) => p.assetClass === "OPT");
    if (!optLegs.length) return null;
  }

  const raw = await genJson<RawPick>({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildPrompt(input),
    schema: PICK_SCHEMA,
    temperature: 0.2,
  });

  // For ROLL_OUT, server constructs the closingLegs from heldPositions and
  // computes net roll credit deterministically — we don't trust the model
  // to echo held-position economics back. Opening legs come from the model
  // (it picked from the chain), and we fill their Greeks from chain truth.
  if (raw.strategy === "ROLL_OUT" && raw.rollPlan) {
    const optLegs = input.heldPositions.filter((p) => p.assetClass === "OPT");
    const closingLegs = optLegs
      .map(buildClosingLeg)
      .filter((l): l is ContractLeg => l !== null);
    const closingCost = Number(closingCostEstimate(optLegs).toFixed(2));
    const openingLegs = raw.rollPlan.openingLegs.map((l) => fillLegFromChain(l, input.chain) ?? l);
    const netRollCredit = Number((raw.rollPlan.openingCredit - closingCost).toFixed(2));
    const rollPlan: RollPlan = {
      closingLegs,
      openingLegs,
      closingCost,
      openingCredit: raw.rollPlan.openingCredit,
      netRollCredit,
      newMaxLoss: raw.rollPlan.newMaxLoss,
      newMaxProfit: raw.rollPlan.newMaxProfit,
      newBreakeven: raw.rollPlan.newBreakeven,
    };
    return {
      strategy: "ROLL_OUT",
      rollPlan,
      // Mirror new-structure economics into the top-level fields so the
      // existing UI metrics (Max P / Max L / Breakeven) keep working.
      limitPrice: raw.limitPrice,
      maxProfit: rollPlan.newMaxProfit,
      maxLoss: rollPlan.newMaxLoss,
      breakeven: rollPlan.newBreakeven,
      suggestedContracts: raw.suggestedContracts,
      capitalRequired: rollPlan.newMaxLoss,
      quotesAvailable: true,
      ivPercentileNote: raw.ivPercentileNote,
      rationale: raw.rationale,
    };
  }

  // Non-roll branch. The LLM picks contract codes + qualitative fields
  // (rationale, ivPercentileNote, suggestedContracts); the server computes
  // economics deterministically from chain bid/ask so the user never sees the
  // model's arithmetic. When chain quotes are missing (e.g. outside RTH on
  // less-liquid OTM strikes), we explicitly mark quotesAvailable=false and
  // zero out the dollar fields rather than fabricating from the LLM —
  // there is no honest source for these economics without live quotes.
  const longLeg = fillLegFromChain(raw.longLeg, input.chain);
  const shortLeg = fillLegFromChain(raw.shortLeg, input.chain);
  const longPutLeg = fillLegFromChain(raw.longPutLeg, input.chain);
  const shortPutLeg = fillLegFromChain(raw.shortPutLeg, input.chain);
  const shortCallLeg = fillLegFromChain(raw.shortCallLeg, input.chain);
  const longCallLeg = fillLegFromChain(raw.longCallLeg, input.chain);
  const stockRows = input.heldPositions.filter((p) => p.assetClass === "STK");
  const heldStockShares = stockRows.reduce((acc, p) => acc + Math.max(0, p.position), 0);
  const heldStockCostBasis = heldStockShares > 0
    ? stockRows.reduce((acc, p) => acc + p.avgCost * Math.max(0, p.position), 0) / heldStockShares
    : null;
  const econ = computeEntryEconomics(
    raw.strategy,
    longLeg,
    shortLeg,
    input.chain,
    raw.suggestedContracts,
    heldStockCostBasis,
    raw.strategy === "IRON_CONDOR"
      ? {
          longPut: longPutLeg,
          shortPut: shortPutLeg,
          shortCall: shortCallLeg,
          longCall: longCallLeg,
        }
      : undefined,
  );
  if (econ) {
    return {
      strategy: raw.strategy,
      longLeg,
      shortLeg,
      longPutLeg,
      shortPutLeg,
      shortCallLeg,
      longCallLeg,
      netDebit: econ.netDebit,
      netCredit: econ.netCredit,
      limitPrice: econ.limitPrice,
      maxProfit: econ.maxProfit,
      maxLoss: econ.maxLoss,
      breakeven: econ.breakeven,
      breakevenLower: econ.breakevenLower,
      breakevenUpper: econ.breakevenUpper,
      suggestedContracts: raw.suggestedContracts,
      capitalRequired: econ.capitalRequired,
      quotesAvailable: true,
      ivPercentileNote: raw.ivPercentileNote,
      rationale: raw.rationale,
    };
  }
  return {
    strategy: raw.strategy,
    longLeg,
    shortLeg,
    longPutLeg,
    shortPutLeg,
    shortCallLeg,
    longCallLeg,
    limitPrice: 0,
    maxProfit: 0,
    maxLoss: 0,
    breakeven: 0,
    suggestedContracts: raw.suggestedContracts,
    capitalRequired: 0,
    quotesAvailable: false,
    ivPercentileNote: raw.ivPercentileNote,
    rationale: raw.rationale,
  };
}

export { pickerEligible };
