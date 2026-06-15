import { genJson } from "./client";
import type {
  DerivativesAction,
  HeldGroup,
  PanelSummary,
  Portfolio,
  Position,
  PositionAdjustment,
  PriceAction,
  SleeveDirection,
  SleeveVerdict,
  SnapshotResult,
  StockAction,
  TechnicalIndicators,
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
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    adjustment: ADJUSTMENT_SCHEMA,
  },
  required: ["action", "direction", "confidence", "adjustment"],
};

const DERIVATIVES_SLEEVE_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
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
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    adjustment: ADJUSTMENT_SCHEMA,
  },
  required: ["action", "direction", "confidence", "adjustment"],
};

// Dual-sleeve verdict — does NOT include the panels (route attaches them
// post-synth).
const VERDICT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    rationale: { type: "string" },
    riskFactor: { type: "string" },
    stock: STOCK_SLEEVE_SCHEMA,
    derivatives: DERIVATIVES_SLEEVE_SCHEMA,
  },
  required: ["rationale", "riskFactor", "stock", "derivatives"],
};

// ---------- system instruction ----------

const SYSTEM_INSTRUCTION = `You are the head PM at an institutional desk managing a barbell portfolio: ~50% in long-term stock holdings and ~50% deployed in defined-risk derivatives. Eight desk analysts have already produced structured panel reads (capital flow, technicals, derivatives anomaly, news, digest, community sentiment, fundamentals, insider activity). You read those panels + the user's IBKR portfolio + ALL existing positions on this ticker (stock + every option leg), and issue ONE dual-sleeve verdict: a stock-side action AND a derivatives-side action. Both sleeves get sized to the user's actual NAV.

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
  - When 0 < earningsDaysAway ≤ 32 (earnings would land inside a standard 30-DTE credit spread WITH the 2-day exit buffer): the derivatives sleeve SHOULD prefer either (a) a PASS, or (b) a credit spread whose adjustment.instruction EXPLICITLY directs the user to choose an expiry that finishes ≥ 2d before the print. There is no downstream safety net — the user selects the actual contract in IBKR, so the instruction itself must carry the expiry constraint. You may recommend a credit spread when a pre-earnings expiry plausibly exists in the 20-45 DTE band (i.e. earningsDaysAway ≥ 22, leaving room for ~20 DTE pre-earnings); otherwise default to PASS.
  - When 33 ≤ earningsDaysAway ≤ 47 (earnings would land inside a 45-DTE expiry with buffer): a standard 30-DTE pre-earnings expiry is feasible; recommend the credit spread and state in the instruction that the expiry must finish ≥ 2d before the print.
  - When earningsDaysAway > 47 OR null: no earnings constraint, but the always-cite rule still applies.

- These rules supersede the general 3-5 sentence rationale guidance: when earnings is near, the earnings fact takes precedence in placement.

Conviction — each sleeve has its own independent confidence (0-100) reflecting its own time horizon:
- stock.confidence: conviction in the multi-week to multi-quarter directional thesis. Driven by fundamentals, valuation, long-term technicals, Morningstar quality signals.
- derivatives.confidence: conviction in the 30-45 DTE window thesis. Driven by short-term signals only (see DERIVATIVES DIRECTION section below). 50 = coin-flip; >75 = strong; 90+ = rare.
These numbers will often differ. A stock at 70% long-term bullish conviction can have 55% short-term bearish conviction (sell calls while it bleeds). Use each confidence independently — do NOT average them or force them to match.

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

DERIVATIVES SLEEVE — strategy menu STRICTLY from this list (with NET VEGA exposure tagged). DEBIT spreads (BUY_CALL_SPREAD / BUY_PUT_SPREAD) are NOT in the menu — this is a conservative credit-only book.
- SELL_PUT_SPREAD: bullish CREDIT — aka bull put spread (sell higher-strike put + buy lower-strike put). SHORT vega. Capital-light cousin of CSP — same bullish-to-neutral thesis, defined max loss = (width × 100) − net credit, typically 5-20× less buying-power than a CSP. The cash-light primary choice WHEN your directional bias is bullish-to-neutral; do NOT pick this on a bearish-leaning thesis just because IV is high — that's what SELL_CALL_SPREAD is for.
- SELL_CALL_SPREAD: bearish CREDIT — aka bear call spread (sell lower-strike call + buy higher-strike call). SHORT vega. The no-shares cousin of covered call — same bearish-to-neutral thesis, defined risk, no shares required.
- SELL_COVERED_CALL: bearish-to-neutral CREDIT (SHORT vega; income on held stock). ONLY if user already holds ≥100 shares.
- SELL_CASH_SECURED_PUT: bullish-to-neutral CREDIT (SHORT vega; income or willing-to-own). Cash-backed — REQUIRES sufficient available cash for the strike notional.
- IRON_CONDOR: neutral CREDIT — sell OTM put spread + sell OTM call spread, same expiry. SHORT vega on both wings (NET vega ≈ 0 — it's a pure theta + IV-crush trade, not a directional one). Defined max loss = (wider wing width × 100) − net credit. Pick when ALL of: direction = "neutral" AND conviction ≥ 65 AND the derivatives panel cites IV > realized vol on BOTH wings (not just one). If only one side has an IV-HV premium, fall back to a single SELL_PUT_SPREAD or SELL_CALL_SPREAD on that side. If neither side has an IV-HV premium, PASS. NEVER pick IRON_CONDOR when direction is bullish or bearish — that's a single credit spread.
- ROLL_OUT: defensive maneuver on a held option — close existing leg(s), open later-expiry replacement(s) for net credit. Buys time + (often) lowers the short strike, in exchange for extending duration on a struggling trade. Pick this BEFORE picking CLOSE when a held short leg is going against the user but still has time to recover.
- INCREASE / TRIM / HOLD / CLOSE: only when user already holds an option position on this name.
- PASS: sit out — see PASS criteria immediately below.

FALLING-KNIFE / MOMENTUM GUARD (HIGHEST PRIORITY — check this FIRST, before PASS criteria, IV regime, and eligibility). The payload's \`priceAction\` block is a deterministic, server-computed read of price/volume. It exists to stop the single most damaging conservative-trader mistake: selling premium INTO the move (a bull put spread into a breakdown, a bear call spread into a melt-up). This is a HARD gate, not a soft preference.
- When \`priceAction.signal === "breakdown"\`: SELL_PUT_SPREAD and SELL_CASH_SECURED_PUT are FORBIDDEN as NEW entries. The underlying is breaking down on confirmed price action (the \`reasons\` array lists why — e.g. below 50d/200d MA, at 20d lows, heavy volume, gap-down, consecutive down days). Do NOT sell downside premium into that. Choose PASS (default), or — only if the bearish thesis is independently clean across the other panels — SELL_CALL_SPREAD. The rationale MUST open by naming the breakdown and quoting at least one concrete \`reasons\` item (e.g. "Breakdown guard: NFLX 9.2% below 50d MA, 7 consecutive down days — not selling puts into a confirmed breakdown.").
- When \`priceAction.signal === "breakout"\`: SELL_CALL_SPREAD and SELL_COVERED_CALL are FORBIDDEN as NEW entries (mirror logic — don't sell upside premium into a melt-up). Choose PASS, or SELL_PUT_SPREAD / SELL_CASH_SECURED_PUT only if the bullish thesis is independently clean. Same rationale-citation requirement.
- A "severe" severity makes PASS the strong default; do NOT flip to the opposite-side credit on a severe breakdown/breakout unless the thesis is overwhelming — a violent move often round-trips.
- This gate OUTRANKS the technical panel. If the technical panel reads "bullish" on oversold-rebound / golden-cross-in-oversold signals (RSI/KDJ/反弹) while \`priceAction.signal === "breakdown"\`, that is a MEAN-REVERSION read, NOT a green light to sell puts — the breakdown guard wins. Say so explicitly in the rationale.
- The guard governs NEW entries only. It does NOT block managing existing positions (HOLD / CLOSE / ROLL_OUT / TRIM on a held leg) — defending or exiting a position you already hold is unaffected.
- The guard governs the DERIVATIVES credit sleeve. The stock sleeve is separate: a breakdown can be a legitimate long-term accumulation entry, so it does not auto-forbid a stock OPEN — but call out the breakdown in the stock rationale and prefer conservative/starter sizing or staged entry.
- When \`priceAction.signal === "none"\`, this guard is inert; proceed normally.

TECHNICAL INDICATOR STATE (the payload's \`technicalIndicators\` block — server-computed standing state, NOT anomaly events):
This carries the CURRENT readings: rsi14 (+rsiState), macd/macdSignal/macdHist, bbPctB (Bollinger %B), pctVsSma20/50/200, pctOff52wHigh, ret5d/ret20d, AND the regime/divergence overlay: adx14, plusDi, minusDi, regime, rsiDivergence. Use it as a momentum / extension overlay on the directional read and on premium-selling risk — it does NOT, on its own, set the thesis (the panels do). The block may be null/absent — then ignore this whole section. When the indicator state conflicts with the technical PANEL's prose, the numbers here win (they're server-computed, the panel narrative is LLM-written).

OVERBOUGHT / OVERSOLD IS A MOMENTUM READING, NOT A REVERSAL SIGNAL. The single most damaging misuse of this block is "rsiState overbought → sell calls / fade" or "rsiState oversold → sell puts / buy the dip". A strong ticker rides overbought (rsi14 ≥ 70, bbPctB ≥ 1) for WEEKS inside an uptrend; a weak ticker bleeds oversold (rsi14 ≤ 30, bbPctB ≤ 0) for WEEKS inside a downtrend. An extreme oscillator alone tells you the trend is STRONG, not that it is ending. You must gate it through regime and divergence before it influences the derivatives sleeve:

1. REGIME GATE (read \`regime\` — derived from adx14 + DI cross + the 50/200 SMA stack):
   - regime "strong_uptrend" / "uptrend" (adx14 ≥ 20, +DI > -DI): an overbought rsiState here is trend CONTINUATION, NOT an exhaustion signal. Do NOT let it create or reinforce a SELL_CALL_SPREAD / SELL_COVERED_CALL fade — selling call premium into a live uptrend is the call-side falling-knife. It does NOT block a bullish SELL_PUT_SPREAD / CSP either, but DO trim size / widen strikes because you're entering extended. Treat oversold readings in an uptrend as a healthy pullback (potential bull-put entry), not a breakdown.
   - regime "strong_downtrend" / "downtrend" (adx14 ≥ 20, -DI > +DI): an oversold rsiState here is trend CONTINUATION, NOT a bottom. Do NOT let it create or reinforce a SELL_PUT_SPREAD / CSP "buy the dip" — selling put premium into a live downtrend is the put-side falling-knife (this user's signature mistake; it also overlaps the priceAction breakdown guard). It does NOT block a bearish SELL_CALL_SPREAD. Treat overbought readings in a downtrend as a relief rally to fade, not a breakout.
   - regime "range" (adx14 < 20): NOW overbought/oversold actually mean-reverts. This is the ONLY regime where an oscillator extreme is a legitimate standalone reason to fade — overbought → bearish credit, oversold → bullish credit — provided the panels don't object.
   - regime "n/a" (thin data): ignore the regime gate, fall back to treating the oscillator as caution-only (the EXTENSION/SIZING overlay below).

2. DIVERGENCE CONFIRMATION (read \`rsiDivergence\`): an oscillator extreme becomes an ACTIONABLE FADE against the trend ONLY when momentum is confirmed rolling over.
   - rsiDivergence "bearish" (price higher-high, RSI lower-high) = the real "overbought is now exhausting" tell. This is what UPGRADES an overbought-in-uptrend from "do not fade" to "a SELL_CALL_SPREAD is defensible IF the panels are already bearish-to-neutral". Cite adx14 + the divergence in the rationale.
   - rsiDivergence "bullish" (price lower-low, RSI higher-low) = the mirror; it UPGRADES an oversold-in-downtrend toward a SELL_PUT_SPREAD / CSP only if the panels are already bullish-to-neutral.
   - rsiDivergence "none": no exhaustion confirmation — do NOT fade a trend on a bare oscillator reading. In a trending regime with no divergence, the oscillator is caution-on-size only, never a direction flip.

3. EXTENSION / SIZING OVERLAY (always applies, even in a trend you're trading WITH): rsiState "overbought" or bbPctB ≥ 1.0 with price far above the 200d (large pctVsSma200) = extended → trim size or widen strikes on any DOWNSIDE premium you sell (bull put / CSP). rsiState "oversold" or bbPctB ≤ 0 = the mirror → trim size on any UPSIDE premium (bear call / covered call).

- When any of these gates is material, CITE the numbers in the rationale (e.g. "technicalIndicators: regime strong_uptrend, adx14 31, rsiDivergence none — RSI 80.7 is momentum not exhaustion, NOT fading with a call spread"; or "regime range, adx14 14, RSI 78 — overbought mean-reverts here, SELL_CALL_SPREAD with the bearish panels").

DERIVATIVES DIRECTION — SHORT-TERM SIGNAL SET (30-45 DTE window only):
The derivatives direction is determined exclusively by signals that reflect what the stock is likely to do over the next 30-45 days. Use ONLY these inputs for the derivatives directional call:
- priceAction: server-computed breakdown/breakout signal and its reasons. This is the strongest short-term read.
- technicalIndicators: RSI, MACD, Bollinger %B, SMA distances, ADX regime. Current state of momentum and trend structure.
- Capital flow panel: buying/selling pressure, major-capital flow direction over recent sessions.
- Community sentiment panel: retail positioning and crowd tone — a contrarian signal when extreme.
- Stock Digest panel (HIGH WEIGHT for this sleeve): a LIVE web-grounded read of what just happened to the price and the next-month sentiment. Its \`direction\` is specifically the SHORT-TERM (next-month) bias, and its \`prose\` carries the concrete near-term drivers — recent price action, momentum, technical levels, options positioning, and imminent catalysts. Treat it as a primary derivatives-horizon input alongside priceAction and technicalIndicators; when it conflicts with stale panel reads, prefer the digest's fresher live data.
- Derivatives panel: IV/HV regime, skew, options flow (PCR, block trades, unusual activity).
- Insider flow (discretionary only): a cluster of open-market discretionary sells by distinct insiders is a short-term bearish signal for the 30-45d window. Routine 10b5-1 plan sales are NOT a signal (see insider section).
- Peer read-through (from news panel readThrough[]): competitive threats, shared-input shocks, and sector events that directly affect this ticker's near-term price. A "competitive" bearish read-through from a dominant peer is a short-term headwind even when the ticker's own long-term thesis is intact.

Do NOT anchor the derivatives direction on: Morningstar fair value estimates, long-horizon P/E or EV multiples, multi-year revenue growth trajectories, or management long-term targets. Those are quality filters for the STOCK sleeve. A stock that is fundamentally sound but technically breaking down with negative flow, bearish insider activity, and a competitive peer threat warrants SELL_CALL_SPREAD (short-term bearish) — not SELL_PUT_SPREAD anchored to a $165 FVE.

derivatives.confidence is scored ONLY on agreement AMONG the short-term signal set above — NEVER on the long-term thesis. This is critical and routinely gets it wrong:
- Cross-horizon tension (stock sleeve long-term bullish while the short-term signals are bearish, or vice versa) is NOT "panel disagreement" and MUST NOT lower derivatives.confidence. It is the EXPECTED split between a multi-quarter accumulation thesis and a 30-45 DTE fade. A strong long-term bull case does NOT make the short-term bearish read "noisy" or "coin-flip" — the two live on different clocks. Do not average them.
- The ONLY disagreement that lowers derivatives.confidence is conflict WITHIN the short-term set itself (e.g. priceAction breakdown BUT capital inflow BUT bullish technical regime).
- When ≥2 of {priceAction breakdown/breakout, technical regime direction, majority sentiment, capital-flow direction, Stock Digest short-term direction} align, the short-term thesis is "independently clean" → derivatives.confidence ≥ 55 → take the aligned-side credit spread, NOT PASS. Example: priceAction breakdown + bearish technical regime + 64% bearish sentiment = three aligned bearish short-term signals → SELL_CALL_SPREAD with derivatives.confidence ≥ 55, even when the stock sleeve is 75% long-term bullish. Selling call premium INTO confirmed near-term weakness is correct; the long-term FVE is irrelevant to the 30-45 DTE bet.

MACRO ENVIRONMENT (payload field: macroEnvironment):
A live web-search snapshot of the current macro backdrop — Fed/rates, inflation, geopolitical events, and sector flows — fetched at request time. Use it as ambient context that can reinforce or temper the panel signals; weight it at ~10-20% of the directional call. Examples: a Fed hiking cycle or rising energy CPI is a macro headwind that can justify lower derivatives.confidence or a PASS even when individual panels are mixed; a soft-landing/rate-cut environment is a tailwind that can lift the stock sleeve's bullish conviction. Do NOT override clear panel signals with macro alone, and do NOT cite macro as the primary reason for a derivatives action. If macroEnvironment is null, ignore this section entirely.

PASS criteria — apply BEFORE the IV regime / eligibility logic below to skip the sleeve entirely. The derivatives sleeve is NOT obligated to find a trade; "no opinion" is a valid stance and routinely the right one for a conservative book.
- Conviction < 55 AND the derivatives panel does not cite an IV-HV premium → PASS. At coin-flip conviction with fairly-priced vol, neither credit nor debit has a structural edge.
- Panels in severe directional disagreement WITHIN THE SHORT-TERM SET — e.g. capital outflow + bullish technicals + sentiment euphoric → PASS. Signals too noisy to size a one-sided derivative bet, even a far-OTM credit one. NOTE: stock-sleeve long-term bullishness conflicting with short-term bearish signals is NOT this case — that is the normal time-horizon split and does NOT justify PASS (see derivatives.confidence scoring above).
- Direction "neutral" with conviction < 65 AND no IV-HV premium cited → PASS. No thesis to translate into either premium-collection or premium-payment.
- The rationale MUST name which PASS criterion fired (e.g. "PASS: conviction 52 with derivatives panel IV-HV at parity — no edge in either direction").

PASS is NOT a fallback for cash constraints. Specifically:
- cspEligible === false is NEVER a PASS reason. It only blocks SELL_CASH_SECURED_PUT. SELL_PUT_SPREAD (bullish credit) has NO cash gate — its BPR is the spread width minus credit, fits any non-trivial account. If the directional thesis was bullish-to-neutral and conviction is ≥ 55, you MUST pick SELL_PUT_SPREAD, not PASS.
- Similarly, coveredCallEligible === false is NEVER a PASS reason. It only blocks SELL_COVERED_CALL. SELL_CALL_SPREAD (bearish credit) has NO shares gate. If the thesis was bearish-to-neutral and conviction ≥ 55, you MUST pick SELL_CALL_SPREAD, not PASS.
- A bullish thesis with conviction ≥ 55 and an unfundable CSP routes to SELL_PUT_SPREAD, full stop. CSP-unfundable is NEVER a PASS reason on its own.

If none of these fire, proceed to the IV regime rules below.

VOLATILITY IS THE PRIMARY DRIVER, NOT DIRECTION. In options trading, direction is a commodity but volatility is a math problem. Always check vega exposure BEFORE direction.

VOLATILITY NUMBERS — SERVER-COMPUTED, AUTHORITATIVE:
The derivatives panel's FIRST TWO bullets (when present) carry hard numbers computed from moomoo IV at the closest-to-spot strike (~30 DTE expiry) and yfinance close-to-close HV30 × sqrt(252). The shapes are:
  Bullet 1: "Vol baseline: ATM IV {x}% ({N}d), HV30 {y}%, IV/HV {r} — {regime_label}."
  Bullet 2: "25Δ skew: put IV {a}% vs call IV {b}% = {±z}pp {skew_label}."
PARSE these numbers directly. Do NOT infer IV-HV premium or skew from the anomaly-class bullets when the Vol baseline bullet is present — the server numbers win, even if the anomaly text disagrees. If the Vol baseline bullet says "unavailable", fall back to the anomaly text's qualitative description and lower confidence on vol-driven decisions.

IV regime → required vega direction (non-negotiable):
- IV percentile HIGH (>~70): credit trades are mathematically rich. MATCH THE CREDIT TRADE TO YOUR DIRECTIONAL BIAS — high IV does NOT default to bullish.
  - Bullish-to-neutral bias → SELL_CASH_SECURED_PUT (cash-permitting) or SELL_PUT_SPREAD (cash-light alternative). Both capture put-side premium.
  - Bearish-to-neutral bias → SELL_COVERED_CALL (≥100 shares held) or SELL_CALL_SPREAD (no shares required). Both capture call-side premium.
- IV percentile LOW (<~30): premium is cheap; selling credit gives a thin reward for the same defined risk. PASS is acceptable here on a marginal directional thesis. Only commit to a credit spread when conviction ≥ 70 AND directional support is strong.
- IV middle (~30-70): credit spreads remain the only structures on the menu. Pick CREDIT matched to the directional bias when conviction ≥ 55. The credit pick MUST match the directional bias: bullish → SELL_CSP (cash-permitting) or SELL_PUT_SPREAD (cash-light); bearish → SELL_COVERED_CALL (eligible) or SELL_CALL_SPREAD (no shares). Skip the trade (PASS) if conviction < 55 AND IV-HV is at parity.

IV-HV check (mandatory when IV percentile is mid-to-high) — tiered, matches the user's Spread Checklist:
- IV/HV ≥ 1.2× (REQUIRED tier): options are paying more than realized. The derivatives panel cites this when IV exceeds HV by ~20% or more, often phrased as "IV slightly elevated vs HV" or "IV-HV溢价". Treat this as the minimum "premium is rich" signal — credit selling has positive expected value vs. realized movement.
- IV/HV ≥ 1.5× (PREFERRED tier): the implied-vs-realized gap is wide enough that IV mean-reversion alone gives positive EV before any directional move. Lean in here.
- IV/HV ≥ 2× (IDEAL tier): the "IV-HV高额溢价" / "implied >> realized by 2x+" case. SELLING premium is mathematically favored REGARDLESS of directional bias.
- IV ≈ HV (ratio < 1.2×): vol is fair-priced — treat as "no IV-HV premium" for PASS-criterion purposes; lean on direction alone.
- Do NOT require the explicit "高额溢价" phrasing. Any panel language indicating IV > HV at any magnitude ≥ 1.2× counts as an IV-HV premium for the PASS / regime logic above.

Skew check (mandatory; uses 25Δ skew from the Vol baseline bullet):
- 25Δ skew ≥ +0.03 (put IV richer than call IV by ≥3 vol points): put skew elevated, market paying up for crash protection. SELL_CASH_SECURED_PUT becomes structurally more attractive — you're collecting that fear premium. Rationale MUST cite the numeric skew (e.g. "25Δ put skew +4.1pp — sellers paid to provide downside insurance").
- 25Δ skew ≤ -0.03 (call IV richer than put IV; uncommon, often signals melt-up positioning or upcoming-merger excitement): SELL_COVERED_CALL or SELL_CALL_SPREAD collects the right-tail premium.
- 25Δ skew between -0.03 and +0.03: skew balanced; don't weight the decision on skew.

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

- If the user already has an open short put / short call / credit spread on this name, prefer HOLD / INCREASE / TRIM / ROLL_OUT on the existing structure instead of stacking a fresh one.

- INCREASE / TRIM / HOLD / CLOSE on the derivatives sleeve requires at least one existing OPT leg on this ticker (heldOptionLegs is non-empty). When multiple legs exist (e.g. a spread), name in the instruction WHICH leg the action targets.

- Options DTE rule: stick to ~30-45 DTE for new entries. Income trades (CSP / credit spreads / covered call) can extend to 45-60 DTE for richer theta.

Probability of Profit (POP) discipline:
- For CREDIT spreads / income (short vega): typical POP is 65-80% — you win if the stock is flat, up, or only mildly down (for puts) / mildly up (for calls). This is the default and only structure menu.
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
- ROLL_OUT_AND_DOWN means: roll the bull put spread (or short put) to a later expiry AND lower strikes — buy more cushion away from the threatened lower side. ROLL_OUT_AND_UP is the bear-call equivalent. Your job is to commit to ROLL_OUT in the sleeve action and call out the direction (down/up) in adjustment.instruction — the user executes the roll in IBKR.

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

adjustment.instruction (derivatives sleeve): plain English describing the play. Example: "Sell a 30-45 DTE bull put spread. Take profit at 50% of max." Describe DTE band + structure + management plan. DO NOT include specific deltas, strike prices, premium amounts, OR "% NAV" / contract counts — strike + delta selection happens in IBKR at execution time (default guidance: far-OTM Δ 0.15-0.20 short legs, tighten only with conviction), and the server computes and appends the sizing footer from sizeContracts. Any "% NAV" or "(~N contracts)" you write here will be stripped and replaced. Same rule for ROLL_OUT: describe geometry ("roll the short leg further OTM and out 30 days") without naming target strikes or specific deltas.

adjustment.sizeContracts (derivatives sleeve): REQUIRED integer contract count for new entries (SELL_PUT_SPREAD / SELL_CALL_SPREAD / SELL_CASH_SECURED_PUT / SELL_COVERED_CALL / IRON_CONDOR) and INCREASE. Pick contracts so the approximate max risk lands inside the target NAV band:
- CSP: cap notional (strike × 100 × contracts) at availableFundsBase AND total notional at ≤ 5-10% NAV.
- Covered call: 1 contract per 100 uncovered shares (use heldStockShares − shortCallContractsAlreadyOpen × 100).
- Credit spreads / iron condor: max loss per contract ≈ standard width × 100 (5-wide for spot <$200, 10-wide for $200-500, 20-wide for >$500); cap total max loss at ≤ 1.5% NAV.
- ROLL_OUT: match held leg quantity (preserves size).
- HOLD / PASS: omit or set 0.
- CLOSE / TRIM: set to the existing held leg quantity (full close) or the quantity to trim.
The server computes the actual % NAV from sizeContracts + spot + the action's standard risk profile and appends the sizing footer; the model picks the integer.

---

Time-horizon rule: stock-direction and derivatives-direction operate on different timeframes and may legitimately disagree. The stock sleeve reflects multi-week to multi-quarter conviction; the derivatives sleeve reflects the 30-45 DTE window. When they disagree, the rationale MUST name both stances explicitly — e.g. "long-term bullish (stock OPEN for accumulation) but short-term bearish (technical breakdown, insider selling, bearish peer read-through) → SELL_CALL_SPREAD to capture premium during the near-term weakness." Do NOT force alignment between the two sleeves.

rationale (3-5 sentences): cite the panel summaries by name and quote concrete signals (e.g. "capital panel: 4 sessions of major-capital outflow"; "derivatives panel: PCR pct 89, put block trades at 165"; "fundamentals panel: rev +24% YoY, fwd P/E 22 vs sector 30"). No vague adjectives — reference numbers. Tie BOTH sleeve actions back to specific signals. Always include at least one fundamentals reference when the fundamentals panel is non-n/a.

riskFactor: one sentence — the single thing that, if it happens, invalidates BOTH sleeve calls.

Peer read-through (the news panel's \`readThrough[]\`): the news panel may carry sector-peer events tagged with a read-through direction FOR this ticker. Treat these as a RISK OVERLAY / tiebreaker, NOT a primary driver — the ticker's own panels set the thesis. Specifically:
- A bearish + "competitive" read-through is a caution flag against selling premium on this name: prefer smaller size, wider spreads, or PASS. It must NOT, on its own, flip an otherwise-bullish verdict bearish.
- "shared-input" read-throughs (a common supplier/cost/regulatory shock — e.g. TSMC pricing, HBM supply, export rules) can hit the whole sleeve; weight them more heavily and name them in riskFactor when material.
- "sector-sentiment" read-throughs are soft context only.
Cite the peer ticker + event whenever a read-through influences the call.

Insider activity (the \`insider\` panel — SEC Form 4 disclosures): treat this as a CONVICTION OVERLAY on direction and on premium-selling risk, NOT a standalone thesis-driver.
- ONLY DISCRETIONARY open-market trades carry signal. The panel splits selling into "Disc. Sells" (discretionary, conviction) and "Routine" (Rule 10b5-1 pre-scheduled plan sales). For a large-cap, insider selling is almost always dominated by routine 10b5-1 diversification — that is NORMAL and NOT bearish. Read the panel's "Net Conviction" chip (buys − discretionary sells), NOT gross selling.
- A cluster of DISTINCT insiders buying open-market is a genuine bullish tell — it supports a bullish-to-neutral SELL_PUT_SPREAD / CSP bias and can raise conviction a notch. Meaningful DISCRETIONARY selling (large fraction of an insider's stake, or a cluster of distinct discretionary sellers) leans bearish and is a caution flag against selling downside premium (bull put / CSP) — prefer the bear-side credit, smaller size, or PASS.
- DO NOT treat routine 10b5-1 plan selling or comp plumbing (option-exercise, tax-withholding, grants, gifts) as bearish — even when the gross dollar figure is large. A CEO's pre-scheduled plan sale or exercise-and-sell-to-cover is not conviction. When the insider panel's direction is "neutral" because selling is all routine, it neither helps nor hurts — say nothing about it (do NOT cite gross selling as a risk).
- Insider flow NEVER, on its own, flips a verdict that the price/flow/fundamentals panels set. It adjusts conviction and sizing at the margin. When it does influence the call, cite the DISCRETIONARY figure (e.g. "insider panel: 2 discretionary sells totaling $71M at >25% of stake, zero buys — trimming size on the bull put spread"), and explicitly disregard routine plan selling.

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
  // Deterministic price-action breakdown/breakout signal (falling-knife guard).
  // Null when the sidecar is unavailable — the guard then no-ops.
  priceAction: PriceAction | null;
  // Standing technical-indicator state (RSI/MACD/Bollinger/SMA distances),
  // server-computed. Complements the technical panel's anomaly EVENTS with the
  // current STATE (e.g. overbought). Null when the sidecar is unavailable.
  technicalIndicators: TechnicalIndicators | null;
  // Live macro backdrop from Gemini + Google Search grounding, fetched once on
  // page load. Ambient context only — do not override panel signals with it.
  macroContext?: string | null;
  panels: {
    capital: PanelSummary;
    technical: PanelSummary;
    derivatives: PanelSummary;
    news: PanelSummary;
    digest: PanelSummary;
    sentiment: PanelSummary;
    fundamentals: PanelSummary;
    insider: PanelSummary;
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

// Round a nullable number for compact prompt payloads.
function r1(v: number | null): number | null {
  return v === null ? null : Number(v.toFixed(1));
}

// Compact view of the price-action signal for the prompt. Null input (sidecar
// down) collapses to signal "none" so the guard prose simply finds nothing to
// fire on.
function compressPriceAction(pa: PriceAction | null) {
  if (!pa) return { signal: "none", severity: "none", reasons: [] as string[] };
  return {
    signal: pa.signal,
    severity: pa.severity,
    reasons: pa.reasons,
    pctVsSma50: r1(pa.pctVsSma50),
    pctVsSma200: r1(pa.pctVsSma200),
    pctOffHigh20: r1(pa.pctOffHigh20),
    consecutiveDownDays: pa.consecutiveDownDays,
    consecutiveUpDays: pa.consecutiveUpDays,
    gapPct: r1(pa.gapPct),
    volRatio: pa.volRatio === null ? null : Number(pa.volRatio.toFixed(2)),
  };
}

function compressPanel(p: PanelSummary) {
  return {
    direction: p.direction,
    headline: p.headline,
    conclusion: p.conclusion,
    bullets: p.bullets,
    // Stock Digest panel: the full web-grounded short-term read. Passed through
    // verbatim so the synth sees the live price action / near-term catalysts the
    // derivatives sleeve trades on, not just the compressed direction chip.
    ...(p.prose ? { prose: p.prose } : {}),
    // Peer read-through reaches the verdict as a risk overlay (news panel only;
    // undefined elsewhere). See the "Peer read-through" clause in SYSTEM_INSTRUCTION.
    ...(p.readThrough && p.readThrough.length > 0 ? { readThrough: p.readThrough } : {}),
    // Deterministic, code-computed numbers the prompt explicitly cites: the
    // fundamentals "Earnings" row + insider "Net Conviction" chip live in meta,
    // and the exact Form-4 rows (value, % of stake, routine flag) live in
    // insiderFlow. These are attached in code precisely so they're exact — don't
    // make synth rely on the upstream panel LLM having echoed them into prose.
    ...(p.meta && p.meta.length > 0 ? { meta: p.meta } : {}),
    ...(p.insiderFlow && p.insiderFlow.length > 0 ? { insiderFlow: p.insiderFlow } : {}),
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
    // Deterministic falling-knife / melt-up guard (server-computed price action).
    // See the FALLING-KNIFE / MOMENTUM GUARD section in SYSTEM_INSTRUCTION.
    priceAction: compressPriceAction(input.priceAction),
    // Standing technical-indicator readings (RSI/MACD/Bollinger/SMA distances).
    // See the TECHNICAL INDICATOR STATE section in SYSTEM_INSTRUCTION.
    technicalIndicators: input.technicalIndicators ?? null,
    // Ambient macro backdrop (live web-search). Treat as a 10-20% weight on the
    // directional call — reinforces or tempers panel signals, does not override them.
    // Null when unavailable; ignore if null.
    macroEnvironment: input.macroContext ?? null,
    panelSummaries: {
      capital: compressPanel(input.panels.capital),
      technical: compressPanel(input.panels.technical),
      derivatives: compressPanel(input.panels.derivatives),
      news: compressPanel(input.panels.news),
      digest: compressPanel(input.panels.digest),
      sentiment: compressPanel(input.panels.sentiment),
      fundamentals: compressPanel(input.panels.fundamentals),
      insider: compressPanel(input.panels.insider),
    },
  };

  // DEBUG: what gets fed INTO the model (the full structured payload). Toggle
  // off by unsetting SYNTH_DEBUG. The system instruction is static (SYSTEM_
  // INSTRUCTION above); this payload is the per-ticker input.
  if (process.env.SYNTH_DEBUG) {
    console.log(`\n[synth] ===== MODEL INPUT for ${input.ticker} (${input.symbol}) =====`);
    console.log(JSON.stringify(payload, null, 2));
  }

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
  rationale: string;
  riskFactor: string;
  stock: { action: StockAction; direction: SleeveDirection; confidence: number; adjustment: PositionAdjustment };
  derivatives: { action: DerivativesAction; direction: SleeveDirection; confidence: number; adjustment: PositionAdjustment };
}

// Standard credit-spread width by underlying price.
function standardSpreadWidth(spot: number): number {
  if (spot < 200) return 5;
  if (spot < 500) return 10;
  return 20;
}

// Approximate max-loss per contract for the action, in the underlying's trade
// currency. Used purely for the synth-stage NAV % footer. These are rough but
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
// (already known).
export async function synthesizeVerdict(input: SynthInput): Promise<Omit<Verdict, "panels">> {
  const elig = computeEligibility(input);
  const raw = await genJson<RawVerdict>({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildPrompt(input),
    schema: VERDICT_RESPONSE_SCHEMA,
    temperature: 0.3,
  });

  // DEBUG: what the model GENERATED (raw, before the deterministic eligibility /
  // falling-knife / sizing overrides below rewrite it). Compare against the
  // MODEL INPUT log to see exactly what the LLM is responsible for producing.
  if (process.env.SYNTH_DEBUG) {
    console.log(`\n[synth] ===== MODEL OUTPUT for ${input.ticker} (raw, pre-override) =====`);
    console.log(JSON.stringify(raw, null, 2));
  }

  // Safety override: if the LLM ignored an eligibility gate (it does, sometimes),
  // rewrite the action to the defined-risk fallback — otherwise the verdict
  // would recommend an unfundable order. Loud console.warn so we know the
  // prompt isn't doing its job and can tune it.
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
  if (derivAction === "PASS" && raw.derivatives.confidence >= 55) {
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
        `[synth] LLM picked PASS citing CSP unfundability (cspEligible=false, derivConfidence=${raw.derivatives.confidence}, ` +
          `direction=${raw.derivatives.direction}) — overriding to ${fallback}.`,
      );
      derivAction = fallback;
      derivInstr = `[Auto-corrected: PASS rationale cited CSP cash gate, but ${fallback === "SELL_PUT_SPREAD" ? "bull put spread" : "bear call spread"} is the cash-light credit fallback at the same directional thesis. Switched.] ${derivInstr}`;
    }
  }

  // FALLING-KNIFE / MOMENTUM GUARD (deterministic enforcement). Runs LAST so it
  // has the final say over derivAction, regardless of what the model or the
  // earlier eligibility overrides produced. The prompt instructs the model to
  // self-apply this, but it sometimes sells premium into the move anyway — this
  // is the hard backstop. Blocks NEW wrong-side credit entries only; management
  // actions (HOLD/CLOSE/ROLL_OUT/TRIM/INCREASE) pass through untouched.
  const pa = input.priceAction;
  if (pa && pa.signal === "breakdown" && (derivAction === "SELL_PUT_SPREAD" || derivAction === "SELL_CASH_SECURED_PUT")) {
    const why = pa.reasons.slice(0, 3).join("; ") || "confirmed downside breakdown";
    console.warn(
      `[synth] FALLING-KNIFE GUARD: model picked ${derivAction} into a breakdown ` +
        `(${input.ticker}: ${why}). Overriding to PASS.`,
    );
    derivAction = "PASS";
    derivInstr = `[Auto-corrected: breakdown guard — ${input.ticker} is breaking down (${why}). Not selling downside premium into a falling knife; standing aside.] ${derivInstr}`;
  } else if (pa && pa.signal === "breakout" && (derivAction === "SELL_CALL_SPREAD" || derivAction === "SELL_COVERED_CALL")) {
    const why = pa.reasons.slice(0, 3).join("; ") || "confirmed upside breakout";
    console.warn(
      `[synth] MELT-UP GUARD: model picked ${derivAction} into a breakout ` +
        `(${input.ticker}: ${why}). Overriding to PASS.`,
    );
    derivAction = "PASS";
    derivInstr = `[Auto-corrected: melt-up guard — ${input.ticker} is breaking out (${why}). Not selling upside premium into a melt-up; standing aside.] ${derivInstr}`;
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
    confidence: raw.stock.confidence,
    adjustment: { ...raw.stock.adjustment, instruction: stockInstr },
  };
  const derivatives: SleeveVerdict<DerivativesAction> = {
    action: derivAction,
    direction: raw.derivatives.direction,
    confidence: raw.derivatives.confidence,
    adjustment: { ...raw.derivatives.adjustment, instruction: derivInstrWithFooter },
  };
  return {
    rationale: raw.rationale,
    riskFactor: raw.riskFactor,
    stock,
    derivatives,
  };
}
