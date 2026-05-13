import { genJson } from "./client";
import type {
  DerivativesAction,
  HeldGroup,
  PanelSummary,
  Portfolio,
  Position,
  PositionAdjustment,
  SleeveDirection,
  SleeveVerdict,
  SnapshotResult,
  StockAction,
  Verdict,
} from "../types";

// ---------- schema fragments ----------

const ADJUSTMENT_SCHEMA = {
  type: "object",
  properties: {
    instruction: { type: "string" },
    sizing: { type: "string" },
    entry: { type: "string" },
    stop: { type: "string" },
    target: { type: "string" },
    timeframe: { type: "string" },
    // Integer share count for the stock sleeve. Required on OPEN/INCREASE/TRIM/
    // CLOSE; 0 (or omit) on HOLD/PASS. Server uses this to compute % NAV.
    sizeShares: { type: ["integer", "null"], minimum: 0 },
    // Integer contract count for the derivatives sleeve. Required on every
    // new-entry strategy + INCREASE/ROLL_OUT; 0 (or omit) on HOLD/PASS/CLOSE/
    // TRIM (close/trim references the held leg count separately). Server uses
    // this to compute % NAV at risk.
    sizeContracts: { type: ["integer", "null"], minimum: 0 },
  },
  required: ["instruction"],
};

const STOCK_SLEEVE_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["OPEN", "INCREASE", "TRIM", "HOLD", "CLOSE", "PASS"],
    },
    direction: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    adjustment: ADJUSTMENT_SCHEMA,
  },
  required: ["action", "direction", "adjustment"],
};

const DERIVATIVES_SLEEVE_SCHEMA = {
  type: "object",
  properties: {
    action: {
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
        "INCREASE",
        "TRIM",
        "HOLD",
        "CLOSE",
        "PASS",
      ],
    },
    direction: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    adjustment: ADJUSTMENT_SCHEMA,
  },
  required: ["action", "direction", "adjustment"],
};

// Dual-sleeve verdict — does NOT include the panels (route attaches them
// post-synth) or contractPick (separate picker call attaches it later).
const VERDICT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    rationale: { type: "string" },
    riskFactor: { type: "string" },
    stock: STOCK_SLEEVE_SCHEMA,
    derivatives: DERIVATIVES_SLEEVE_SCHEMA,
  },
  required: ["confidence", "rationale", "riskFactor", "stock", "derivatives"],
};

// ---------- system instruction ----------

const SYSTEM_INSTRUCTION = `You are the head PM at an institutional desk managing a barbell portfolio: ~50% in long-term stock holdings and ~50% deployed in defined-risk derivatives. Seven desk analysts have already produced structured panel reads (capital flow, technicals, derivatives anomaly, news, digest, community sentiment, fundamentals). You read those panels + the user's IBKR portfolio + ALL existing positions on this ticker (stock + every option leg), and issue ONE dual-sleeve verdict: a stock-side action AND a derivatives-side action. Both sleeves get sized to the user's actual NAV.

The fundamentals panel is the longest-horizon input — valuation, growth, margins, balance-sheet, analyst targets, next earnings date. Treat it as the QUALITY filter: a stock that screens "bullish" on flow + technicals but is fundamentally broken (negative FCF, decelerating growth, debt-equity > 3x) is a weaker thesis than the technicals alone suggest. Conversely, fundamentals "neutral" on a name with strong technical/flow signals does NOT veto an entry — it just caps conviction. ALWAYS check the fundamentals panel for nextEarningsDate: if earnings are within ~10 days, prefer SHORT-vega income trades (CSP/covered call) over DEBIT spreads, because IV will crush after the print regardless of direction.

EARNINGS HANDLING (this user is a CONSERVATIVE TRADER who wants to be FULLY OUT of every options trade ≥ 2 days BEFORE earnings):
- The fundamentals panel headline will BEGIN with "[EARNINGS in {N}d]" when earningsDaysAway ≤ 14, or END with "(earnings in {N}d)" when 15 ≤ earningsDaysAway ≤ 30. Parse N from there. The actual ISO date should also appear in the fundamentals panel's [Calendar] bullet or in its meta row labeled "Earnings".

- ALWAYS-CITE rule (mandatory on every derivatives sleeve, regardless of action):
  - When the fundamentals panel reveals a future nextEarningsDate: rationale MUST include the literal phrase "Earnings {N}d away on {YYYY-MM-DD}" (integer N, ISO date) somewhere in the prose.
  - When NO future earnings date is in fundamentals: rationale MUST include the literal phrase "No earnings in fundamentals — no earnings constraint applies."
  - This sentence is the user's primary scan for earnings risk. It is required on PASS / HOLD / OPEN / CLOSE / ROLL_OUT — all derivatives actions.

- When earningsDaysAway ≤ 14:
  - rationale: the earnings-cite sentence MUST be the FIRST sentence of the rationale.
  - rationale: the recommendation MUST explain how it shapes the action — e.g. "...preferring a sub-earnings expiry that closes ≥ 2d before the print."
  - riskFactor: MUST start with the literal prefix "Earnings risk: " before the rest of the risk sentence.

- CONSERVATIVE-TRADER GATE (replaces the old "prefer short vega on debit when earnings ≤ 10d" rule):
  - When 0 < earningsDaysAway ≤ 32 (earnings would land inside a standard 30-DTE credit spread WITH the 2-day exit buffer): the derivatives sleeve SHOULD prefer either (a) a PASS, or (b) a credit spread sized so the picker can choose a sub-earnings expiry ≥ 2d before the print. The picker has the chain and will refuse to recommend an earnings-straddle expiry; if no preEarningsSafe expiry exists in the chain, the route layer will flip the action to PASS. So you may recommend a credit spread when you are confident a pre-earnings expiry exists in the 20-45 DTE band (i.e. earningsDaysAway ≥ 22, leaving room for ~20 DTE pre-earnings); otherwise default to PASS.
  - When 33 ≤ earningsDaysAway ≤ 47 (earnings would land inside a 45-DTE expiry with buffer): a standard 30-DTE pre-earnings expiry is feasible; recommend the credit spread but cite that the picker will be steered toward a pre-earnings expiry.
  - When earningsDaysAway > 47 OR null: no earnings constraint, but the always-cite rule still applies.

- These rules supersede the general 3-5 sentence rationale guidance: when earnings is near, the earnings fact takes precedence in placement.

Conviction (single confidence 0-100): your overall directional read. 50 = coin-flip; >75 = strong; 90+ = rare. Both sleeves share this confidence — they just translate it into different products.

The user may hold MULTIPLE positions on the same ticker — e.g. long stock + a short covered call, or both legs of a vertical spread. Treat them as a structure: read the net stock shares and the option legs together. A position with quantity > 0 is LONG, quantity < 0 is SHORT.

---

STOCK SLEEVE (action ∈ {OPEN, INCREASE, TRIM, HOLD, CLOSE, PASS}):
- If the user holds the stock (heldStockShares > 0): choose INCREASE / TRIM / HOLD / CLOSE.
- If the user holds option legs but no stock: choose PASS unless the stock thesis is independently strong, in which case OPEN with conservative sizing (and call out that this adds to existing option exposure).
- If the user holds nothing on this ticker: OPEN (when conviction ≥60 and direction is decisive) or PASS.
- direction: "bullish" / "bearish" / "neutral" — the stock-sleeve directional bias.
- adjustment.instruction: plain English describing the play. Example: "Open a starter position between $180-185, stop $172." DO NOT include "% NAV" or any percent-of-portfolio phrasing in this text — the server computes the actual NAV percentage from sizeShares and appends a sizing footer. Any "% NAV" you write here will be stripped and replaced.
- adjustment.sizeShares: REQUIRED integer share count for OPEN/INCREASE/TRIM/CLOSE. Pick an integer that, multiplied by current spot and FX-converted to the portfolio's baseCurrency, lands inside the target NAV band (institutional starter: 0.3-0.7% NAV; full-conviction add: up to 2% NAV; trim: ~30-50% of current position; close: full held quantity). Use 0 or omit on HOLD/PASS. Compute it from the snapshot.lastPrice + the portfolio block — do not guess.
- For OPEN/INCREASE: set sizeShares, entry, stop, target, timeframe.
- For TRIM: sizeShares = shares to trim; keep-rationale in instruction.
- For HOLD: sizeShares omitted; instruction names what to watch for that would change the call.
- For CLOSE: sizeShares = full held share count; entry = "at market" or "on bounce to $X".
- For PASS: sizeShares omitted; instruction explains why (e.g. "thesis intact but fully sized; revisit on pullback").

---

DERIVATIVES SLEEVE — strategy menu STRICTLY from this list (with NET VEGA exposure tagged):
- BUY_CALL_SPREAD: bullish DEBIT (LONG vega; net long premium). Defined risk both sides.
- BUY_PUT_SPREAD: bearish DEBIT (LONG vega; net long premium). Defined risk both sides.
- SELL_PUT_SPREAD: bullish CREDIT — aka bull put spread (sell higher-strike put + buy lower-strike put). SHORT vega. Capital-light cousin of CSP — same bullish-to-neutral thesis, defined max loss = (width × 100) − net credit, typically 5-20× less buying-power than a CSP. The cash-light primary choice WHEN your directional bias is bullish-to-neutral; do NOT pick this on a bearish-leaning thesis just because IV is high — that's what SELL_CALL_SPREAD is for.
- SELL_CALL_SPREAD: bearish CREDIT — aka bear call spread (sell lower-strike call + buy higher-strike call). SHORT vega. The no-shares cousin of covered call — same bearish-to-neutral thesis, defined risk, no shares required.
- SELL_COVERED_CALL: bearish-to-neutral CREDIT (SHORT vega; income on held stock). ONLY if user already holds ≥100 shares.
- SELL_CASH_SECURED_PUT: bullish-to-neutral CREDIT (SHORT vega; income or willing-to-own). Cash-backed — REQUIRES sufficient available cash for the strike notional.
- IRON_CONDOR: neutral CREDIT — sell OTM put spread + sell OTM call spread, same expiry. SHORT vega on both wings (NET vega ≈ 0 — it's a pure theta + IV-crush trade, not a directional one). Defined max loss = (wider wing width × 100) − net credit. Pick when ALL of: direction = "neutral" AND conviction ≥ 65 AND the derivatives panel cites IV > realized vol on BOTH wings (not just one). If only one side has an IV-HV premium, fall back to a single SELL_PUT_SPREAD or SELL_CALL_SPREAD on that side. If neither side has an IV-HV premium, PASS. NEVER pick IRON_CONDOR when direction is bullish or bearish — that's a single credit spread.
- ROLL_OUT: defensive maneuver on a held option — close existing leg(s), open later-expiry replacement(s) for net credit. Buys time + (often) lowers the short strike, in exchange for extending duration on a struggling trade. Pick this BEFORE picking CLOSE when a held short leg is going against the user but still has time to recover.
- INCREASE / TRIM / HOLD / CLOSE: only when user already holds an option position on this name.
- PASS: sit out — see PASS criteria immediately below.

PASS criteria — apply BEFORE the IV regime / eligibility logic below to skip the sleeve entirely. The derivatives sleeve is NOT obligated to find a trade; "no opinion" is a valid stance and routinely the right one for a conservative book.
- Conviction < 55 AND the derivatives panel does not cite an IV-HV premium → PASS. At coin-flip conviction with fairly-priced vol, neither credit nor debit has a structural edge.
- Panels in severe directional disagreement — e.g. capital outflow + bullish technicals + sentiment euphoric, or fundamentals weakening while flow is strong → PASS. Signals too noisy to size a one-sided derivative bet, even a far-OTM credit one.
- Direction "neutral" with conviction < 65 AND no IV-HV premium cited → PASS. No thesis to translate into either premium-collection or premium-payment.
- The rationale MUST name which PASS criterion fired (e.g. "PASS: conviction 52 with derivatives panel IV-HV at parity — no edge in either direction").

PASS is NOT a fallback for cash constraints. Specifically:
- cspEligible === false is NEVER a PASS reason. It only blocks SELL_CASH_SECURED_PUT. SELL_PUT_SPREAD (bullish credit) has NO cash gate — its BPR is the spread width minus credit, fits any non-trivial account. If the directional thesis was bullish-to-neutral and conviction is ≥ 55, you MUST pick SELL_PUT_SPREAD, not PASS.
- Similarly, coveredCallEligible === false is NEVER a PASS reason. It only blocks SELL_COVERED_CALL. SELL_CALL_SPREAD (bearish credit) has NO shares gate. If the thesis was bearish-to-neutral and conviction ≥ 55, you MUST pick SELL_CALL_SPREAD, not PASS.
- DO NOT bundle "CSP unfundable" + "conviction too low for debit" into a PASS. Conviction thresholds on debit spreads (≥ 75) are about VEGA/POP geometry on long-premium trades — they have NO bearing on credit-spread selection. A bullish thesis with conviction 60 and an unfundable CSP routes to SELL_PUT_SPREAD, full stop.

If none of these fire, proceed to the IV regime rules below.

VOLATILITY IS THE PRIMARY DRIVER, NOT DIRECTION. In options trading, direction is a commodity but volatility is a math problem. Always check vega exposure BEFORE direction.

IV regime → required vega direction (non-negotiable):
- IV percentile HIGH (>~70): you MUST be SHORT or NEUTRAL vega. MATCH THE CREDIT TRADE TO YOUR DIRECTIONAL BIAS — high IV does NOT default to bullish.
  - Bullish-to-neutral bias → SELL_CASH_SECURED_PUT (cash-permitting) or SELL_PUT_SPREAD (cash-light alternative). Both capture put-side premium.
  - Bearish-to-neutral bias → SELL_COVERED_CALL (≥100 shares held) or SELL_CALL_SPREAD (no shares required). Both capture call-side premium.
  - NEVER pick a debit spread in this regime — IV crush after the move can leave you flat or down even when direction is right.
- IV percentile LOW (<~30): debit spreads (LONG vega) are the right tool — premium is cheap and a vol expansion adds tailwind. BUY_CALL_SPREAD (bullish) or BUY_PUT_SPREAD (bearish).
- IV middle (~30-70): vega is a wash; the tie-breaker is conviction × IV-HV spread (see below). Default to CREDIT when conviction <70 — income trades have higher probability of profit and don't require a directional move to win. The credit pick MUST match the directional bias: bullish → SELL_CSP (cash-permitting) or SELL_PUT_SPREAD (cash-light); bearish → SELL_COVERED_CALL (eligible) or SELL_CALL_SPREAD (no shares). Default to DEBIT (BUY_*_SPREAD) only when conviction ≥75 AND direction is decisive.

IV-HV check (mandatory when IV percentile is mid-to-high):
- If the derivatives panel cites IV >> HV (e.g. "IV-HV高额溢价" or implied >> realized by 2x+), the option market is overpaying for fear. SELLING premium is mathematically favored REGARDLESS of directional bias — the stock isn't moving as much as options imply.
- If IV ≈ HV or IV < HV, vol is fair-priced; lean on direction.

Skew check (mandatory):
- If the derivatives panel mentions OTM puts trading at materially higher IV than OTM calls (put skew elevated), the market is paying up for crash protection. SELL_CASH_SECURED_PUT becomes structurally more attractive — you're collecting that fear premium.
- If call skew is elevated (less common), SELL_COVERED_CALL collects the right-tail premium.

Leveraged-ETF rule (overrides bullish-credit/bearish-credit defaults):
- For daily-reset 3x leveraged ETFs (TQQQ, SQQQ, SOXL, SOXS, UPRO, SPXU, SPXL, SPXS, FAS, FAZ, TNA, TZA, LABU, LABD, NUGT, DUST, JNUG, JDST, BOIL, KOLD, and similar 2x/3x leveraged products): PREFER the spread variants over CSP / covered call regardless of cash eligibility. Specifically: bullish-to-neutral → SELL_PUT_SPREAD (NOT SELL_CASH_SECURED_PUT); bearish-to-neutral → SELL_CALL_SPREAD (NOT SELL_COVERED_CALL even if shares are held).
- Reason: these products have built-in volatility decay from the daily-reset mechanic. Holding them via assignment (CSP) or via the underlying stock leg (covered call) inherits that decay. The defined-risk spreads cap the loss at (width × 100) − credit and never require holding the leveraged product through assignment.
- The rationale MUST cite the leveraged-ETF rule by name when this override fires (e.g. "switching from CSP to SELL_PUT_SPREAD because SOXL is a 3x leveraged ETF — daily-reset decay makes assignment a structurally bad outcome regardless of cash eligibility").

Eligibility hard rules — these gate strategy selection. The server has pre-computed BOOLEANS in eligibility.{coveredCallEligible, cspEligible}. TRUST THEM. Do NOT redo the math — currency conversion and threshold logic are already applied.

- eligibility.coveredCallEligible === false → SELL_COVERED_CALL is FORBIDDEN. If your directional bias would otherwise be bearish-to-neutral, you MUST pick SELL_CALL_SPREAD instead (same thesis, no shares required, defined risk).

- eligibility.cspEligible === false → SELL_CASH_SECURED_PUT is FORBIDDEN. NO EXCEPTIONS. The user does NOT have enough cash for even one contract — picking CSP would result in an unfundable order. If your directional bias would otherwise be bullish-to-neutral, you MUST pick SELL_PUT_SPREAD instead (same thesis, ~10-20× less buying power required, defined risk via the long protective leg).
  - When you fall back from CSP to SELL_PUT_SPREAD, the rationale MUST cite the actual numbers from the eligibility block: "eligibility.cspMinFundsBase = {cspMinFundsBase} {cspBaseCurrency} required vs. cspAvailableFundsBase = {cspAvailableFundsBase} {cspBaseCurrency} available — CSP unfundable, switching to bull put spread."
  - Do NOT use phrases like "user could top up cash" or "assuming user adds funds" — work with the portfolio as-is.

- eligibility.cspEligible === true → SELL_CASH_SECURED_PUT is permitted but not required; SELL_PUT_SPREAD remains a valid alternative when you want capital-efficiency or defined risk on the downside (the spread limits the loss if the underlying gaps below the long strike).

- SELL_PUT_SPREAD / SELL_CALL_SPREAD never have a cash gate (defined-risk via the long protective leg). Their BPR ≈ (width × 100) − net credit per contract — a 5-wide spread has ~$500 BPR/contract minus credit, fits any non-trivial portfolio. Always available as the bullish-credit / bearish-credit fallback.

- BUY_CALL_SPREAD / BUY_PUT_SPREAD have no eligibility gate beyond having any cash at all. Sizing is the constraint, not eligibility.

- If the user already has an open short put / short call / credit spread on this name, prefer HOLD / INCREASE / TRIM / ROLL_OUT on the existing structure instead of stacking a fresh one.

- INCREASE / TRIM / HOLD / CLOSE on the derivatives sleeve requires at least one existing OPT leg on this ticker (heldOptionLegs is non-empty). When multiple legs exist (e.g. a spread), name in the instruction WHICH leg the action targets.

- Options DTE rule: stick to ~30-45 DTE for new entries. Income trades (CSP / credit spreads / covered call) can extend to 45-60 DTE for richer theta.

Probability of Profit (POP) discipline:
- For DEBIT spreads (long vega): typical POP is 30-45% — you need direction AND vol cooperation. Only justify when conviction ≥75.
- For CREDIT spreads / income (short vega): typical POP is 65-80% — you win if the stock is flat, up, or only mildly down (for puts) / mildly up (for calls). Default choice when conviction is moderate.
- Mention the approximate POP regime in the rationale ("CSP at 30Δ ≈ 70% POP").

Management discipline for held CREDIT positions (apply BEFORE direction/Greeks logic):
These two rules fire on existing short-premium positions (CSP, covered call, credit spread, or the short legs of any structure the user opened) regardless of overall directional thesis. They are the institutional standard for short-premium management.
- 50% RULE: when the held position has captured ≥50% of its maximum profit, output action CLOSE on that derivatives sleeve. Don't wait for the last 50% — gamma risk and IV-expansion risk dominate the remaining theta payoff. The freed capital recycles into a fresh 30-45 DTE trade with a higher probability of profit.
- READ THE CAPTURED FRACTION FROM positionManagement[].pnlPctOfMax — it is server-computed, sign-correct, and unit-correct. POSITIVE means winning (0.50 = 50% of max profit captured, 1.00 = max profit reached); NEGATIVE means losing (-0.50 = currently down ~half the max profit you could ever earn on this trade).
- PHRASING RULE (critical — avoid ambiguity): when pnlPctOfMax is POSITIVE, say "captured X% of max profit" or "X% of the way to max profit". When pnlPctOfMax is NEGATIVE, say "currently DOWN X% of max profit (losing $|pnl| of a $maxProfit max)" or "underwater by X% of max profit" — NEVER write "at -X% of max profit", because users misread that as "+X% profit". Always make the win/lose direction unambiguous in plain English.
- DO NOT compute captured from avgCost and mktPrice yourself. Those fields have INCOMPATIBLE units in IBKR's payload: avgCost for OPT is per-contract dollars (already includes the 100x multiplier), while mktPrice is per-share quoted premium. Dividing them produces a 100x error — a position at 42% captured will look like 99% captured. Use pnlPctOfMax exclusively for this rule.
- 21 DTE RULE: when ANY held SHORT leg has daysToExpiry ≤ 21, the leg is in the gamma-risk zone — a single bad day can wipe out weeks of decay, and assignment risk (especially on ITM short puts near ex-div) starts to matter. Choose CLOSE if the position is at ≥50% max profit OR if you're net-positive at all (just take it). Choose ROLL_OUT if the leg is losing AND the underlying thesis is intact OR neutral. NEVER choose HOLD on a credit position with DTE ≤ 21 unless the user is deliberately running it to expiration for tax-lot reasons (and even then, flag the risk in the rationale).
- These rules OUTRANK the Held-leg Greeks check below — if the 50% target is hit OR DTE ≤ 21, the management decision is made before delta even matters.

Position Management Status (deterministic, server-computed):
- The user's held legs on this ticker have been auto-grouped into structures (BULL_PUT_SPREAD, BEAR_CALL_SPREAD, COVERED_CALL, CSP, LONG_CALL, etc.) with three trigger flags pre-evaluated against the tastytrade defaults: pt50Hit, dteUnder21, stopBreached. Each group also carries a ruleSuggestion ∈ {HOLD, CLOSE, ROLL_OUT, ROLL_OUT_AND_DOWN, ROLL_OUT_AND_UP}.
- TRUST these flags. They use real numbers (avgCost vs. mktPrice, dte from expiry, openCredit). Do not recompute or second-guess them.
- When a group has a ruleSuggestion of CLOSE / ROLL_OUT*, your derivatives.action SHOULD match (CLOSE → CLOSE; ROLL_OUT* → ROLL_OUT). If you choose differently, the rationale MUST explain WHY — e.g. "ruleSuggestion CLOSE on the BULL_PUT_SPREAD because pt50Hit, but I'd HOLD because earnings are 3 days out and IV is collapsing post-print, so the remaining theta will harvest fast".
- ROLL_OUT_AND_DOWN means: roll the bull put spread (or short put) to a later expiry AND lower strikes — buy more cushion away from the threatened lower side. ROLL_OUT_AND_UP is the bear-call equivalent. The contract picker downstream consumes this hint; your job is to commit to ROLL_OUT in the sleeve action and call out the direction in adjustment.instruction.

- ROLL-INTO-EARNINGS GUARD: when the rule-based suggestion is ROLL_OUT* AND the held leg is at a LOSS (positionManagement[].pnlPctOfMax < 0) AND earningsDaysAway is non-null AND ≤ 47 (a typical 30-DTE roll target would land inside or beyond the earnings buffer): output action CLOSE instead of ROLL_OUT. The conservative profile won't carry a losing credit position into the print, and rolling +30-60 DTE into an earnings-straddle compounds the risk that triggered the roll. Rationale MUST state: "Held leg losing (pnlPctOfMax {value}) and rolling would land inside the earnings window (earnings {N}d away on {YYYY-MM-DD}) — closing instead." Re-entry post-print can be evaluated on a fresh thesis.

Held-leg Greeks check (CRITICAL — drives defensive decisions on existing positions):
Each OPT row in heldPositions includes a liveGreeks object with delta, theta, vega, iv when available. Use them. The numbers tell you whether a held position is winning, losing, or in defensive territory.
- SHORT leg defense thresholds (quantity < 0):
  - Short put with liveGreeks.delta < -0.40 → moving against user; consider ROLL_OUT (down-and-out for credit) before delta hits -0.50.
  - Short put with liveGreeks.delta in [-0.40, -0.20] → on track; HOLD or take profit (CLOSE) if most of the premium is gone (mktValue near 0 vs. avgCost).
  - Short call with liveGreeks.delta > 0.40 → moving against user; consider ROLL_OUT (up-and-out for credit).
  - Short call with liveGreeks.delta in [0.20, 0.40] → on track.
- LONG leg in a debit spread (quantity > 0):
  - |delta| growing toward 1.0 = spread is deep ITM and winning → CLOSE to capture profit (don't let theta erode the win).
  - |delta| collapsing toward 0 = spread is dying → CLOSE (cut the loss) or HOLD if there's still room and time.
- Theta interpretation: short legs collecting strong negative theta (e.g. < -3.00) per contract are working hard for you — keep them open. Theta near 0 means the trade has stopped paying — close it.
- IV interpretation: liveGreeks.iv on the held leg vs. the chain's near-ATM IV (from the derivatives panel) tells you whether IV has expanded since entry. IV expansion on a short leg = bad (the leg is now more expensive to close); IV crush on a short leg = good (leg cheaper to close, take profit).

ROLL_OUT decision rule (when you'd otherwise pick CLOSE on a held credit position):
- Pick ROLL_OUT when ALL of: (a) the leg is losing (current mktPrice > avgCost for a short — i.e. it would cost more to close than the credit collected), (b) thesis is intact OR neutral (you don't want to flip direction), AND (c) EITHER current DTE ≤ 21 (the 21-DTE rule kicks in and rolling buys time), OR held leg's |delta| has crossed the defensive threshold (>0.40 for a short single leg, >0.55 for a short leg in a spread).
- DO NOT pick ROLL_OUT when: thesis has decisively flipped (just CLOSE), the held leg is already deep ITM with little time value left (rolling rarely yields credit — accept the loss), or this would be the SECOND defensive roll on the same trade (rule of thumb: roll once, then take the loss). If the position is at ≥50% max profit (50% rule) OR net positive at DTE ≤ 21, prefer CLOSE over ROLL_OUT — capture the win, recycle the capital.
- ROLL_OUT direction MUST match the held leg's structural direction (short put → keep selling puts at lower strike; short call → keep selling calls at higher strike). The "direction" field on the sleeve reflects the user's overall directional bias, NOT the leg geometry.

When the user holds an existing options structure (e.g. a 175/180 call spread), do NOT pretend it is a single contract. Reason about both legs and prefer actions that close/adjust the structure as a whole when the thesis flips.

adjustment.instruction (derivatives sleeve): plain English describing the play. Example: "Sell a 30-45 DTE bull put spread. Take profit at 50% of max." Describe DTE band + structure + management plan. DO NOT include specific deltas, strike prices, premium amounts, OR "% NAV" / contract counts — the contract picker downstream owns strike + delta selection from the live chain (defaults to far-OTM Δ 0.15-0.20 short legs and only tightens with conviction), and the server computes and appends the sizing footer from sizeContracts. Any "% NAV" or "(~N contracts)" you write here will be stripped and replaced. Same rule for ROLL_OUT: describe geometry ("roll the short leg further OTM and out 30 days") without naming target strikes or specific deltas.

adjustment.sizeContracts (derivatives sleeve): REQUIRED integer contract count for new entries (SELL_PUT_SPREAD / SELL_CALL_SPREAD / SELL_CASH_SECURED_PUT / SELL_COVERED_CALL / IRON_CONDOR / BUY_CALL_SPREAD / BUY_PUT_SPREAD) and INCREASE. Pick contracts so the approximate max risk lands inside the target NAV band:
- CSP: cap notional (strike × 100 × contracts) at availableFundsBase AND total notional at ≤ 5-10% NAV.
- Covered call: 1 contract per 100 uncovered shares (use heldStockShares − shortCallContractsAlreadyOpen × 100).
- Credit spreads / iron condor: max loss per contract ≈ standard width × 100 (5-wide for spot <$200, 10-wide for $200-500, 20-wide for >$500); cap total max loss at ≤ 1.5% NAV.
- Debit spreads: max loss per contract ≈ ~35% of standard width × 100; cap at ≤ 0.5% NAV.
- ROLL_OUT: match held leg quantity (preserves size).
- HOLD / PASS: omit or set 0.
- CLOSE / TRIM: set to the existing held leg quantity (full close) or the quantity to trim.
The server computes the actual % NAV from sizeContracts + spot + the action's standard risk profile and appends the sizing footer; the model picks the integer.

---

Conflict rule: stock-direction and derivatives-direction can disagree only as an explicit hedge (e.g. trim stock + buy puts), and you must explain why in the rationale. Otherwise both sleeves share the directional bias.

rationale (3-5 sentences): cite the panel summaries by name and quote concrete signals (e.g. "capital panel: 4 sessions of major-capital outflow"; "derivatives panel: PCR pct 89, put block trades at 165"; "fundamentals panel: rev +24% YoY, fwd P/E 22 vs sector 30"). No vague adjectives — reference numbers. Tie BOTH sleeve actions back to specific signals. Always include at least one fundamentals reference when the fundamentals panel is non-n/a.

riskFactor: one sentence — the single thing that, if it happens, invalidates BOTH sleeve calls.

Hard rules:
- Sizing always references the user's actual portfolio (NAV, available cash, current position size).
- Don't recommend covered calls when no shares are held.
- Don't invent panel facts — only cite what the panels actually say.`;

// ---------- input shaping ----------

export interface SynthInput {
  ticker: string;
  symbol: string;
  snapshot: SnapshotResult | null;
  portfolio: Portfolio | null;
  heldPositions: Position[];
  heldGroups: HeldGroup[];
  panels: {
    capital: PanelSummary;
    technical: PanelSummary;
    derivatives: PanelSummary;
    news: PanelSummary;
    digest: PanelSummary;
    sentiment: PanelSummary;
    fundamentals: PanelSummary;
  };
}

// Map a moomoo-style symbol prefix to its trade currency.
function tradeCurrency(symbol: string): string {
  const dot = symbol.indexOf(".");
  const market = dot > 0 ? symbol.slice(0, dot).toUpperCase() : "US";
  if (market === "US") return "USD";
  if (market === "HK") return "HKD";
  if (market === "SH" || market === "SZ") return "CNY";
  if (market === "SG") return "SGD";
  return "USD";
}

// Convert an amount in `currency` to the user's base currency using the IBKR
// ledger's per-currency exchangeRate. Falls back to a fixed table if the
// ledger doesn't carry that currency yet (e.g. user has no positions in it).
function toBaseCurrency(amount: number, currency: string, portfolio: SynthInput["portfolio"]): number {
  if (!portfolio) return amount;
  if (currency === portfolio.baseCurrency) return amount;
  const entry = portfolio.ledger.find((l) => l.currency === currency);
  if (entry?.exchangeRate && Number.isFinite(entry.exchangeRate)) {
    return amount * entry.exchangeRate;
  }
  // Rough SGD-base fallbacks; only used when the ledger doesn't have the row.
  const fallback: Record<string, number> = { USD: 1.35, HKD: 0.17, CNY: 0.18, SGD: 1 };
  return amount * (fallback[currency] ?? 1);
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(dateStr);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
}

function compressPanel(p: PanelSummary) {
  return {
    direction: p.direction,
    headline: p.headline,
    conclusion: p.conclusion,
    bullets: p.bullets,
  };
}

// Sum stock shares across all STK rows for the ticker (covered-call eligibility).
function totalHeldStockShares(positions: Position[]): number {
  return positions
    .filter((p) => p.assetClass === "STK")
    .reduce((acc, p) => acc + Math.max(0, p.position), 0);
}

// Compact, model-friendly view of one held position. STK rows omit option-only
// fields; OPT rows include strike/expiry/right + a derived side label.
function compressHeldPosition(p: Position) {
  const side = p.position > 0 ? "LONG" : p.position < 0 ? "SHORT" : "FLAT";
  if (p.assetClass === "OPT") {
    return {
      assetClass: "OPT",
      contractDesc: p.contractDesc,
      side,
      quantity: p.position,
      strike: p.strike,
      right: p.putOrCall,
      expiry: p.expiry,
      daysToExpiry: daysUntil(p.expiry ?? null),
      avgCost: p.avgCost,
      mktPrice: p.mktPrice,
      mktValue: p.mktValue,
      unrealizedPnl: p.unrealizedPnl,
      currency: p.currency,
      liveGreeks: p.liveGreeks ?? null,
    };
  }
  return {
    assetClass: p.assetClass,
    contractDesc: p.contractDesc,
    side,
    quantity: p.position,
    avgCost: p.avgCost,
    mktPrice: p.mktPrice,
    mktValue: p.mktValue,
    unrealizedPnl: p.unrealizedPnl,
    currency: p.currency,
  };
}

function compressHeldGroup(g: HeldGroup) {
  return {
    kind: g.kind,
    underlying: g.underlying,
    expiry: g.expiry,
    dte: g.dte,
    openCredit: Number(g.openCredit.toFixed(2)),
    liveClose: Number(g.liveClose.toFixed(2)),
    pnl: Number(g.pnl.toFixed(2)),
    pnlPctOfMax: g.pnlPctOfMax === null ? null : Number(g.pnlPctOfMax.toFixed(3)),
    triggers: g.triggers,
    ruleSuggestion: g.suggestion,
    ...(g.dataIssue ? { dataIssue: g.dataIssue } : {}),
  };
}

interface EligibilityFacts {
  heldStockShares: number;
  shortCallCount: number;
  coveredCallEligible: boolean;
  cspEligible: boolean;
  cspMinFundsBase: number;
  cspAvailableFundsBase: number;
  cspTradeCurrency: string;
  cspBaseCurrency: string;
}

// Pure function used by both buildPrompt (passed to the model) and
// synthesizeVerdict (used for the post-response safety override). Same numbers
// either way — the model and the server both see identical eligibility.
function computeEligibility(input: SynthInput): EligibilityFacts {
  const stockShares = totalHeldStockShares(input.heldPositions);
  const shortCallCount = input.heldPositions
    .filter((p) => p.assetClass === "OPT" && p.putOrCall === "C" && p.position < 0)
    .reduce((acc, p) => acc + Math.abs(p.position), 0);
  const coveredCallEligible = stockShares >= 100 && shortCallCount * 100 < stockShares;

  const spotInTradeCcy = input.snapshot?.lastPrice ?? 0;
  const tradeCcy = tradeCurrency(input.symbol);
  const cspMinTradeCcy = spotInTradeCcy * 0.92 * 100;
  const cspMinBase = toBaseCurrency(cspMinTradeCcy, tradeCcy, input.portfolio);
  const availFundsBase = input.portfolio?.summary.availableFunds ?? 0;
  const cspEligible = availFundsBase >= cspMinBase && cspMinBase > 0;

  return {
    heldStockShares: stockShares,
    shortCallCount,
    coveredCallEligible,
    cspEligible,
    cspMinFundsBase: Math.round(cspMinBase),
    cspAvailableFundsBase: Math.round(availFundsBase),
    cspTradeCurrency: tradeCcy,
    cspBaseCurrency: input.portfolio?.baseCurrency ?? "USD",
  };
}

function buildPrompt(input: SynthInput): string {
  const optionLegs = input.heldPositions.filter((p) => p.assetClass === "OPT");
  const elig = computeEligibility(input);

  const payload = {
    ticker: input.ticker,
    symbol: input.symbol,
    today: new Date().toISOString().slice(0, 10),
    snapshot: input.snapshot && {
      lastPrice: input.snapshot.lastPrice,
      prevClose: input.snapshot.prevClose,
      changePct: Number(input.snapshot.changePct.toFixed(2)),
      volume: input.snapshot.volume,
      name: input.snapshot.name,
      updateTime: input.snapshot.updateTime,
    },
    portfolio: input.portfolio && {
      accountId: input.portfolio.accountId,
      baseCurrency: input.portfolio.baseCurrency,
      netLiquidationSGD: input.portfolio.summary.netLiquidation,
      totalCashSGD: input.portfolio.summary.totalCash,
      availableFundsSGD: input.portfolio.summary.availableFunds,
      buyingPowerSGD: input.portfolio.summary.buyingPower,
      grossPositionValueSGD: input.portfolio.summary.grossPositionValue,
      positionCount: input.portfolio.positions.length,
    },
    heldPositions: input.heldPositions.map(compressHeldPosition),
    positionManagement: input.heldGroups
      .filter((g) => g.underlying === input.ticker.toUpperCase() && !g.dataIssue && g.kind !== "STOCK")
      .map(compressHeldGroup),
    eligibility: {
      heldStockShares: elig.heldStockShares,
      coveredCallEligible: elig.coveredCallEligible,
      heldOptionLegs: optionLegs.length,
      shortCallContractsAlreadyOpen: elig.shortCallCount,
      // CSP cash gate (server-computed — DO NOT recompute, use as-is).
      cspEligible: elig.cspEligible,
      cspMinFundsBase: elig.cspMinFundsBase,
      cspAvailableFundsBase: elig.cspAvailableFundsBase,
      cspTradeCurrency: elig.cspTradeCurrency,
      cspBaseCurrency: elig.cspBaseCurrency,
    },
    panelSummaries: {
      capital: compressPanel(input.panels.capital),
      technical: compressPanel(input.panels.technical),
      derivatives: compressPanel(input.panels.derivatives),
      news: compressPanel(input.panels.news),
      digest: compressPanel(input.panels.digest),
      sentiment: compressPanel(input.panels.sentiment),
      fundamentals: compressPanel(input.panels.fundamentals),
    },
  };

  return [
    `Synthesize a dual-sleeve verdict for ${input.ticker} (${input.symbol}).`,
    "",
    "Inputs (panels are pre-analyzed — read, don't re-analyze):",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "Return both stock and derivatives sleeve actionables per schema.",
  ].join("\n");
}

interface RawVerdict {
  confidence: number;
  rationale: string;
  riskFactor: string;
  stock: { action: StockAction; direction: SleeveDirection; adjustment: PositionAdjustment };
  derivatives: { action: DerivativesAction; direction: SleeveDirection; adjustment: PositionAdjustment };
}

// Standard credit-spread width by underlying price (matches contract-picker).
function standardSpreadWidth(spot: number): number {
  if (spot < 200) return 5;
  if (spot < 500) return 10;
  return 20;
}

// Approximate max-loss per contract for the action, in the underlying's trade
// currency. Used purely for the synth-stage NAV % footer — the contract picker
// downstream computes the real number from live quotes. These are rough but
// representative for sizing display.
function approxRiskPerContractTradeCcy(action: DerivativesAction, spot: number): number {
  if (spot <= 0) return 0;
  switch (action) {
    case "SELL_CASH_SECURED_PUT":
      // CSP capital = strike notional ≈ spot × 100 (strike typically ≈ 0.92×spot,
      // but we want a directionally honest upper bound for the user).
      return spot * 100;
    case "SELL_COVERED_CALL":
      // No incremental capital — the shares already count in NAV.
      return 0;
    case "SELL_PUT_SPREAD":
    case "SELL_CALL_SPREAD":
    case "IRON_CONDOR":
      // Credit spread max loss ≈ width × 100 (minus credit, ignored here).
      return standardSpreadWidth(spot) * 100;
    case "BUY_CALL_SPREAD":
    case "BUY_PUT_SPREAD":
      // Debit spread max loss = debit × 100; typical debit is ~35% of width.
      return standardSpreadWidth(spot) * 100 * 0.35;
    default:
      // ROLL_OUT preserves size; INCREASE/TRIM/HOLD/CLOSE/PASS don't open
      // new risk at synth-time granularity.
      return 0;
  }
}

// Strip any model-emitted "% NAV" / "(~N% NAV)" / "sized at ~N% NAV" fragments
// so we can append the server-computed sizing footer without doubling up.
// Order matters: peel off the wrapping phrase ("sized at X% NAV") before the
// bare "X% NAV" pattern, otherwise we leave dangling prepositions.
function stripNavPctPhrases(s: string): string {
  if (!s) return s;
  return s
    // "sized at/to ~N% NAV (~N contracts)" or "sized at ~N% NAV" — full phrase
    .replace(
      /,?\s*sized\s+(?:at|to)\s+~?\s*\d+(?:\.\d+)?\s*%\s*(?:of\s+)?NAV(?:\s*\(\s*~?\s*\d+\s+contracts?\s*\))?\s*/gi,
      " ",
    )
    // Parenthesized "(~N% NAV)" or "(~N% of NAV)"
    .replace(/\(\s*~?\s*\d+(?:\.\d+)?\s*%\s*(?:of\s+)?NAV\s*\)/gi, " ")
    // Bare "~N% NAV" anywhere else
    .replace(/~?\s*\d+(?:\.\d+)?\s*%\s*(?:of\s+)?NAV/gi, " ")
    // Stand-alone "(~N contracts)" — the footer states the contract count itself
    .replace(/\(\s*~?\s*\d+\s+contracts?\s*\)/gi, " ")
    // Collapse whitespace + tidy punctuation
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

function appendStockSizingFooter(
  instruction: string,
  shares: number,
  spotTrade: number,
  tradeCcy: string,
  navBase: number,
  portfolio: SynthInput["portfolio"],
): string {
  const cleaned = stripNavPctPhrases(instruction);
  if (!shares || shares <= 0 || spotTrade <= 0 || navBase <= 0) return cleaned;
  const spotBase = toBaseCurrency(spotTrade, tradeCcy, portfolio);
  const pct = (shares * spotBase / navBase) * 100;
  return `${cleaned} (Sized: ${shares} shares ≈ ${pct.toFixed(1)}% NAV)`;
}

function appendDerivativesSizingFooter(
  instruction: string,
  contracts: number,
  action: DerivativesAction,
  spotTrade: number,
  tradeCcy: string,
  navBase: number,
  portfolio: SynthInput["portfolio"],
): string {
  const cleaned = stripNavPctPhrases(instruction);
  if (!contracts || contracts <= 0 || navBase <= 0) return cleaned;
  const perContractTrade = approxRiskPerContractTradeCcy(action, spotTrade);
  if (perContractTrade <= 0) {
    // Covered call / ROLL_OUT / management actions: just state the contract count.
    return `${cleaned} (Sized: ${contracts} contract${contracts === 1 ? "" : "s"})`;
  }
  const perContractBase = toBaseCurrency(perContractTrade, tradeCcy, portfolio);
  const pct = (contracts * perContractBase / navBase) * 100;
  return `${cleaned} (Sized: ${contracts} contract${contracts === 1 ? "" : "s"} ≈ ${pct.toFixed(1)}% NAV max risk)`;
}

// Returns the dual-sleeve verdict fields only — the route attaches the panels
// (already known) and the optional contractPick (from the downstream picker).
export async function synthesizeVerdict(input: SynthInput): Promise<Omit<Verdict, "panels">> {
  const elig = computeEligibility(input);
  const raw = await genJson<RawVerdict>({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildPrompt(input),
    schema: VERDICT_RESPONSE_SCHEMA,
    temperature: 0.3,
  });

  // Safety override: if the LLM ignored an eligibility gate (it does, sometimes),
  // rewrite the action to the defined-risk fallback before the picker sees it.
  // The picker would otherwise size an unfundable order. Loud console.warn so
  // we know the prompt isn't doing its job and can tune it.
  let derivAction = raw.derivatives.action;
  let derivInstr = raw.derivatives.adjustment.instruction;
  if (derivAction === "SELL_CASH_SECURED_PUT" && !elig.cspEligible) {
    console.warn(
      `[synth] LLM picked SELL_CASH_SECURED_PUT despite cspEligible=false ` +
        `(avail=${elig.cspAvailableFundsBase} ${elig.cspBaseCurrency} < min=${elig.cspMinFundsBase} ${elig.cspBaseCurrency}). ` +
        `Overriding to SELL_PUT_SPREAD.`,
    );
    derivAction = "SELL_PUT_SPREAD";
    derivInstr = `[Auto-corrected: insufficient cash for CSP — ${elig.cspAvailableFundsBase} ${elig.cspBaseCurrency} available vs. ~${elig.cspMinFundsBase} ${elig.cspBaseCurrency} required. Switched to bull put spread.] ${derivInstr}`;
  }
  if (derivAction === "SELL_COVERED_CALL" && !elig.coveredCallEligible) {
    console.warn(
      `[synth] LLM picked SELL_COVERED_CALL despite coveredCallEligible=false ` +
        `(heldStockShares=${elig.heldStockShares}). Overriding to SELL_CALL_SPREAD.`,
    );
    derivAction = "SELL_CALL_SPREAD";
    derivInstr = `[Auto-corrected: ${elig.heldStockShares} shares held, need ≥100 for covered call. Switched to bear call spread.] ${derivInstr}`;
  }

  // PASS-with-cash-constraint override. The model sometimes bundles "CSP
  // unfundable" + "conviction too low for debit" into a single PASS, even
  // though SELL_PUT_SPREAD remains a valid bullish credit fallback (defined
  // risk, no cash gate, lower conviction threshold than debit). Detect that
  // path by the rationale/instruction citing the CSP unfundable signature
  // and route to the directional credit-spread fallback.
  if (derivAction === "PASS" && raw.confidence >= 55) {
    const combined = `${derivInstr} ${raw.rationale}`.toLowerCase();
    const citesCspGate =
      combined.includes("cspmin") ||
      combined.includes("csp unfundable") ||
      combined.includes("unfundable") ||
      (combined.includes("csp") && combined.includes("insufficient"));
    if (citesCspGate && !elig.cspEligible) {
      const fallback: DerivativesAction =
        raw.derivatives.direction === "bearish" ? "SELL_CALL_SPREAD" : "SELL_PUT_SPREAD";
      console.warn(
        `[synth] LLM picked PASS citing CSP unfundability (cspEligible=false, conviction=${raw.confidence}, ` +
          `direction=${raw.derivatives.direction}) — overriding to ${fallback}.`,
      );
      derivAction = fallback;
      derivInstr = `[Auto-corrected: PASS rationale cited CSP cash gate, but ${fallback === "SELL_PUT_SPREAD" ? "bull put spread" : "bear call spread"} is the cash-light credit fallback at the same directional thesis. Switched.] ${derivInstr}`;
    }
  }

  // Server-computed sizing footer: strip any "% NAV" prose the model wrote
  // and append the deterministic version computed from sizeShares / sizeContracts
  // + live spot + FX-converted NAV. The model is no longer the source of truth
  // for sizing percentages (it routinely hallucinated 100× errors on small NAVs).
  const spotTrade = input.snapshot?.lastPrice ?? 0;
  const tradeCcy = tradeCurrency(input.symbol);
  const navBase = input.portfolio?.summary.netLiquidation ?? 0;

  const stockShares = raw.stock.adjustment.sizeShares ?? 0;
  const stockInstr = appendStockSizingFooter(
    raw.stock.adjustment.instruction,
    stockShares,
    spotTrade,
    tradeCcy,
    navBase,
    input.portfolio,
  );

  const derivContracts = raw.derivatives.adjustment.sizeContracts ?? 0;
  const derivInstrWithFooter = appendDerivativesSizingFooter(
    derivInstr,
    derivContracts,
    derivAction,
    spotTrade,
    tradeCcy,
    navBase,
    input.portfolio,
  );

  const stock: SleeveVerdict<StockAction> = {
    action: raw.stock.action,
    direction: raw.stock.direction,
    adjustment: { ...raw.stock.adjustment, instruction: stockInstr },
  };
  const derivatives: SleeveVerdict<DerivativesAction> = {
    action: derivAction,
    direction: raw.derivatives.direction,
    adjustment: { ...raw.derivatives.adjustment, instruction: derivInstrWithFooter },
  };
  return {
    confidence: raw.confidence,
    rationale: raw.rationale,
    riskFactor: raw.riskFactor,
    stock,
    derivatives,
  };
}
