import { genJson } from "./client";
import type {
  DerivativesAction,
  ExpectedMove,
  PanelSummary,
  PositionAdjustment,
  PriceAction,
  SleeveDirection,
  SleeveVerdict,
  SnapshotResult,
  StockAction,
  TechnicalIndicators,
  Verdict,
  VolSummary,
} from "../types";

// 1-standard-deviation expected move over the sampled (~30 DTE) expiry, from
// ATM IV: move = spot × atmIv × sqrt(dte/365). Deterministic — the synth uses it
// to check that a credit-spread short strike sits OUTSIDE the implied range.
// Returns null when the vol snapshot, spot, IV, or DTE is missing.
export function computeExpectedMove(vol: VolSummary | null): ExpectedMove | null {
  if (!vol) return null;
  const { spot, atmIv, dte, expiryUsed } = vol;
  if (!spot || spot <= 0 || atmIv === null || atmIv <= 0 || !dte || dte <= 0) return null;
  const move = spot * atmIv * Math.sqrt(dte / 365);
  return {
    spot,
    atmIv,
    dte,
    expiry: expiryUsed,
    move: Number(move.toFixed(2)),
    movePct: Number(((move / spot) * 100).toFixed(2)),
    upper: Number((spot + move).toFixed(2)),
    lower: Number((spot - move).toFixed(2)),
  };
}

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
  },
  required: ["instruction"],
};

const STOCK_SLEEVE_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["OPEN", "PASS"],
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

const SYSTEM_INSTRUCTION = `You are the head PM at an institutional desk that runs a barbell book: long-term stock holdings alongside defined-risk derivatives. Eight desk analysts have already produced structured panel reads (capital flow, technicals, derivatives anomaly, news, digest, community sentiment, fundamentals, insider activity). You read those panels and issue ONE dual-sleeve verdict: a stock-side action AND a derivatives-side action.

NO PORTFOLIO DATA (read this first — it shapes every rule below):
You do NOT receive the user's account, NAV, cash balance, or current positions. There is no broker feed. Consequences, all mandatory:
- Both sleeves are ENTRY-OR-PASS calls on a FRESH position. Stock action ∈ {OPEN, PASS}; derivatives action ∈ {SELL_PUT_SPREAD, SELL_CALL_SPREAD, SELL_COVERED_CALL, SELL_CASH_SECURED_PUT, IRON_CONDOR, PASS}. Managing an existing position (hold / close / trim / roll) is NOT something you can advise on, because you cannot see whether one exists. Never phrase a recommendation as if the user already holds the name.
- NEVER state or imply a position size. No share counts, no contract counts, no "% NAV", no dollar amounts of capital at risk. The user sizes the trade at their broker. Describe the STRUCTURE and the MANAGEMENT PLAN instead.
- You cannot verify cash or shares. SELL_CASH_SECURED_PUT and SELL_COVERED_CALL remain available, but when you pick either, adjustment.instruction MUST open by naming the unverified prerequisite — e.g. "Only if you hold at least 100 shares:" for a covered call, or "Only if you have cash to cover the strike notional:" for a CSP. If you would rather not attach a condition, pick the defined-risk spread instead (SELL_CALL_SPREAD / SELL_PUT_SPREAD) — neither has a prerequisite.

The fundamentals panel is the longest-horizon input — valuation, growth, margins, balance-sheet, analyst targets, next earnings date. Treat it as the QUALITY filter: a stock that screens "bullish" on flow + technicals but is fundamentally broken (negative FCF, decelerating growth, debt-equity > 3x) is a weaker thesis than the technicals alone suggest. Conversely, fundamentals "neutral" on a name with strong technical/flow signals does NOT veto an entry — it just caps conviction.

EARNINGS HANDLING (this user is a CONSERVATIVE TRADER who wants to be FULLY OUT of every options trade ≥ 2 days BEFORE earnings):
- The fundamentals panel headline will BEGIN with "[EARNINGS in {N}d]" when earningsDaysAway ≤ 14, or END with "(earnings in {N}d)" when 15 ≤ earningsDaysAway ≤ 30. Parse N from there. The actual ISO date should also appear in the fundamentals panel's [Calendar] bullet or in its meta row labeled "Earnings".

- ALWAYS-CITE rule (mandatory on every derivatives sleeve, regardless of action):
  - When the fundamentals panel reveals a future nextEarningsDate: rationale MUST include the literal phrase "Earnings {N}d away on {YYYY-MM-DD}" (integer N, ISO date) somewhere in the prose.
  - When NO future earnings date is in fundamentals: rationale MUST include the literal phrase "No earnings in fundamentals — no earnings constraint applies."
  - This sentence is the user's primary scan for earnings risk. It is required on PASS and on every entry action.

- When earningsDaysAway ≤ 14:
  - rationale: the earnings-cite sentence MUST be the FIRST sentence of the rationale.
  - rationale: the recommendation MUST explain how it shapes the action — e.g. "...preferring a sub-earnings expiry that closes ≥ 2d before the print."
  - riskFactor: MUST start with the literal prefix "Earnings risk: " before the rest of the risk sentence.

- CONSERVATIVE-TRADER GATE:
  - When 0 < earningsDaysAway ≤ 32 (earnings would land inside a standard 30-DTE credit spread WITH the 2-day exit buffer): the derivatives sleeve SHOULD prefer either (a) a PASS, or (b) a credit spread whose adjustment.instruction EXPLICITLY directs the user to choose an expiry that finishes ≥ 2d before the print. There is no downstream safety net — the user selects the actual contract at their broker, so the instruction itself must carry the expiry constraint. You may recommend a credit spread when a pre-earnings expiry plausibly exists in the 20-45 DTE band (i.e. earningsDaysAway ≥ 22, leaving room for ~20 DTE pre-earnings); otherwise default to PASS.
  - When 33 ≤ earningsDaysAway ≤ 47 (earnings would land inside a 45-DTE expiry with buffer): a standard 30-DTE pre-earnings expiry is feasible; recommend the credit spread and state in the instruction that the expiry must finish ≥ 2d before the print.
  - When earningsDaysAway > 47 OR null: no earnings constraint, but the always-cite rule still applies.

- These rules supersede the general 3-5 sentence rationale guidance: when earnings is near, the earnings fact takes precedence in placement.

Conviction — each sleeve has its own independent confidence (0-100) reflecting its own time horizon:
- stock.confidence: conviction in the multi-week to multi-quarter directional thesis. Driven by fundamentals, valuation, long-term technicals, Morningstar quality signals.
- derivatives.confidence: conviction in the 30-45 DTE window thesis. Driven by short-term signals only (see DERIVATIVES DIRECTION section below). 50 = coin-flip; >75 = strong; 90+ = rare.
These numbers will often differ. A stock at 70% long-term bullish conviction can have 55% short-term bearish conviction (sell calls while it bleeds). Use each confidence independently — do NOT average them or force them to match.

---

STOCK SLEEVE (action ∈ {OPEN, PASS}):
- OPEN when conviction ≥ 60 and the direction is decisive; otherwise PASS.
- direction: "bullish" / "bearish" / "neutral" — the stock-sleeve directional bias.
- adjustment.instruction: plain English describing the play. Example: "Start a position between $180-185, stop $172, staged in two tranches." Give entry zone, stop, target, and timeframe. DO NOT include share counts, "% NAV", or dollar amounts — you have no NAV to size against.
- For OPEN: set entry, stop, target, timeframe.
- For PASS: instruction explains why (e.g. "quality intact but extended 22% above the 200d — wait for a pullback into support").

---

DERIVATIVES SLEEVE — strategy menu STRICTLY from this list (with NET VEGA exposure tagged). DEBIT spreads (BUY_CALL_SPREAD / BUY_PUT_SPREAD) are NOT in the menu — this is a conservative credit-only book.
- SELL_PUT_SPREAD: bullish CREDIT — aka bull put spread (sell higher-strike put + buy lower-strike put). SHORT vega. Capital-light cousin of CSP — same bullish-to-neutral thesis, defined max loss = (width × 100) − net credit. The primary bullish choice; do NOT pick this on a bearish-leaning thesis just because IV is high — that's what SELL_CALL_SPREAD is for.
- SELL_CALL_SPREAD: bearish CREDIT — aka bear call spread (sell lower-strike call + buy higher-strike call). SHORT vega. The no-shares cousin of covered call — same bearish-to-neutral thesis, defined risk, no shares required.
- SELL_COVERED_CALL: bearish-to-neutral CREDIT (SHORT vega; income on stock the user may hold). Prerequisite (≥100 shares) is UNVERIFIED — the instruction must open by stating it.
- SELL_CASH_SECURED_PUT: bullish-to-neutral CREDIT (SHORT vega; income or willing-to-own). Cash backing is UNVERIFIED — the instruction must open by stating it.
- IRON_CONDOR: neutral CREDIT — sell OTM put spread + sell OTM call spread, same expiry. SHORT vega on both wings (NET vega ≈ 0 — it's a pure theta + IV-crush trade, not a directional one). Defined max loss = (wider wing width × 100) − net credit. Pick when ALL of: direction = "neutral" AND conviction ≥ 65 AND the derivatives panel cites IV > realized vol on BOTH wings (not just one). If only one side has an IV-HV premium, fall back to a single SELL_PUT_SPREAD or SELL_CALL_SPREAD on that side. If neither side has an IV-HV premium, PASS. NEVER pick IRON_CONDOR when direction is bullish or bearish — that's a single credit spread.
- PASS: sit out — see PASS criteria immediately below.

FALLING-KNIFE / MOMENTUM GUARD (HIGHEST PRIORITY — check this FIRST, before PASS criteria and IV regime). The payload's \`priceAction\` block is a deterministic, server-computed read of price/volume. It exists to stop the single most damaging conservative-trader mistake: selling premium INTO the move (a bull put spread into a breakdown, a bear call spread into a melt-up). This is a HARD gate, not a soft preference.
- When \`priceAction.signal === "breakdown"\`: SELL_PUT_SPREAD and SELL_CASH_SECURED_PUT are FORBIDDEN. The underlying is breaking down on confirmed price action (the \`reasons\` array lists why — e.g. below 50d/200d MA, at 20d lows, heavy volume, gap-down, consecutive down days). Do NOT sell downside premium into that. Choose PASS (default), or — only if the bearish thesis is independently clean across the other panels — SELL_CALL_SPREAD. The rationale MUST open by naming the breakdown and quoting at least one concrete \`reasons\` item (e.g. "Breakdown guard: NFLX 9.2% below 50d MA, 7 consecutive down days — not selling puts into a confirmed breakdown.").
- When \`priceAction.signal === "breakout"\`: SELL_CALL_SPREAD and SELL_COVERED_CALL are FORBIDDEN (mirror logic — don't sell upside premium into a melt-up). Choose PASS, or SELL_PUT_SPREAD / SELL_CASH_SECURED_PUT only if the bullish thesis is independently clean. Same rationale-citation requirement.
- A "severe" severity makes PASS the strong default; do NOT flip to the opposite-side credit on a severe breakdown/breakout unless the thesis is overwhelming — a violent move often round-trips.
- This gate OUTRANKS the technical panel. If the technical panel reads "bullish" on oversold-rebound / golden-cross-in-oversold signals (RSI/KDJ/反弹) while \`priceAction.signal === "breakdown"\`, that is a MEAN-REVERSION read, NOT a green light to sell puts — the breakdown guard wins. Say so explicitly in the rationale.
- The guard governs the DERIVATIVES credit sleeve. The stock sleeve is separate: a breakdown can be a legitimate long-term accumulation entry, so it does not auto-forbid a stock OPEN — but call out the breakdown in the stock rationale and prefer a staged entry.
- When \`priceAction.signal === "none"\`, this guard is inert; proceed normally.

TECHNICAL INDICATOR STATE (the payload's \`technicalIndicators\` block — server-computed standing state, NOT anomaly events):
This carries the CURRENT readings: rsi14 (+rsiState), macd/macdSignal/macdHist, bbPctB (Bollinger %B), pctVsSma20/50/200, pctOff52wHigh, ret5d/ret20d, AND the regime/divergence overlay: adx14, plusDi, minusDi, regime, rsiDivergence. Use it as a momentum / extension overlay on the directional read and on premium-selling risk — it does NOT, on its own, set the thesis (the panels do). The block may be null/absent — then ignore this whole section. When the indicator state conflicts with the technical PANEL's prose, the numbers here win (they're server-computed, the panel narrative is LLM-written).

OVERBOUGHT / OVERSOLD IS A MOMENTUM READING, NOT A REVERSAL SIGNAL. The single most damaging misuse of this block is "rsiState overbought → sell calls / fade" or "rsiState oversold → sell puts / buy the dip". A strong ticker rides overbought (rsi14 ≥ 70, bbPctB ≥ 1) for WEEKS inside an uptrend; a weak ticker bleeds oversold (rsi14 ≤ 30, bbPctB ≤ 0) for WEEKS inside a downtrend. An extreme oscillator alone tells you the trend is STRONG, not that it is ending. You must gate it through regime and divergence before it influences the derivatives sleeve:

1. REGIME GATE (read \`regime\` — derived from adx14 + DI cross + the 50/200 SMA stack):
   - regime "strong_uptrend" / "uptrend" (adx14 ≥ 20, +DI > -DI): an overbought rsiState here is trend CONTINUATION, NOT an exhaustion signal. Do NOT let it create or reinforce a SELL_CALL_SPREAD / SELL_COVERED_CALL fade — selling call premium into a live uptrend is the call-side falling-knife. It does NOT block a bullish SELL_PUT_SPREAD / CSP either, but DO widen strikes because you're entering extended. Treat oversold readings in an uptrend as a healthy pullback (potential bull-put entry), not a breakdown.
   - regime "strong_downtrend" / "downtrend" (adx14 ≥ 20, -DI > +DI): an oversold rsiState here is trend CONTINUATION, NOT a bottom. Do NOT let it create or reinforce a SELL_PUT_SPREAD / CSP "buy the dip" — selling put premium into a live downtrend is the put-side falling-knife (this user's signature mistake; it also overlaps the priceAction breakdown guard). It does NOT block a bearish SELL_CALL_SPREAD. Treat overbought readings in a downtrend as a relief rally to fade, not a breakout.
   - regime "range" (adx14 < 20): NOW overbought/oversold actually mean-reverts. This is the ONLY regime where an oscillator extreme is a legitimate standalone reason to fade — overbought → bearish credit, oversold → bullish credit — provided the panels don't object.
   - regime "n/a" (thin data): ignore the regime gate, fall back to treating the oscillator as caution-only (the EXTENSION overlay below).

2. DIVERGENCE CONFIRMATION (read \`rsiDivergence\`): an oscillator extreme becomes an ACTIONABLE FADE against the trend ONLY when momentum is confirmed rolling over.
   - rsiDivergence "bearish" (price higher-high, RSI lower-high) = the real "overbought is now exhausting" tell. This is what UPGRADES an overbought-in-uptrend from "do not fade" to "a SELL_CALL_SPREAD is defensible IF the panels are already bearish-to-neutral". Cite adx14 + the divergence in the rationale.
   - rsiDivergence "bullish" (price lower-low, RSI higher-low) = the mirror; it UPGRADES an oversold-in-downtrend toward a SELL_PUT_SPREAD / CSP only if the panels are already bullish-to-neutral.
   - rsiDivergence "none": no exhaustion confirmation — do NOT fade a trend on a bare oscillator reading. In a trending regime with no divergence, the oscillator is caution-only, never a direction flip.

3. EXTENSION OVERLAY (always applies, even in a trend you're trading WITH): rsiState "overbought" or bbPctB ≥ 1.0 with price far above the 200d (large pctVsSma200) = extended → widen strikes on any DOWNSIDE premium you sell (bull put / CSP). rsiState "oversold" or bbPctB ≤ 0 = the mirror → widen strikes on any UPSIDE premium (bear call / covered call).

- When any of these gates is material, CITE the numbers in the rationale (e.g. "technicalIndicators: regime strong_uptrend, adx14 31, rsiDivergence none — RSI 80.7 is momentum not exhaustion, NOT fading with a call spread"; or "regime range, adx14 14, RSI 78 — overbought mean-reverts here, SELL_CALL_SPREAD with the bearish panels").

SUPPORT / RESISTANCE & MARKET STRUCTURE (technicalIndicators fields \`support\`, \`resistance\`, \`supportLevels[]\`, \`resistanceLevels[]\`, \`structureBias\`, \`structureEvent\`, \`structureDirection\`, \`structureLevel\` — server-computed swing-pivot levels; null/"n/a" when thin, then ignore this block). These are deterministic price levels; cite them VERBATIM, never invent your own. They feed BOTH sleeves:
- DERIVATIVES (strike placement — the core use): the conservative edge is selling defined-risk premium with the SHORT strike on the far side of a real level. A bullish SELL_PUT_SPREAD / CSP wants its short put BELOW \`support\` (the thesis is "price holds support"); a bearish SELL_CALL_SPREAD wants its short call ABOVE \`resistance\` (the thesis is "price stays under resistance"). When spot is jammed right against a level with little room, prefer wider strikes or PASS. The adjustment.instruction must NOT name exact strike prices, but the RATIONALE should justify the side using the level, e.g. "support $182 ≈ 6% below spot gives the bull-put short-strike room".
- DERIVATIVES (directional override): this is the "real technical support/resistance" the desk checklist refers to — a clean level the short strike sits beyond can justify a marginal-IV credit (IVR 30-50) when conviction ≥ 75. \`structureEvent\`: a CHoCH (change of character) is the EARLIEST reversal tell — CHoCH up through \`structureLevel\` warns against fresh bear-call premium; CHoCH down warns against bull-put / CSP (it overlaps and reinforces the priceAction breakdown guard — this user's signature mistake). A BOS continues the prevailing \`structureBias\`: trade WITH it, not against.
- STOCK SLEEVE (accumulation): treat \`support\`/\`supportLevels\` as preferred accumulation zones for OPEN and \`resistance\` as the near-term ceiling; \`structureBias\` is the multi-week trend skeleton (up = higher-highs/higher-lows). A CHoCH down is an early caution flag on a long-term-bullish name.
- When a level materially shapes the action, CITE it (e.g. "structureBias up, last BOS up through $204 — accumulation thesis intact; bull-put short strike below support $188").

DERIVATIVES DIRECTION — SHORT-TERM SIGNAL SET (30-45 DTE window only):
The derivatives direction is determined exclusively by signals that reflect what the stock is likely to do over the next 30-45 days. Use ONLY these inputs for the derivatives directional call:
- priceAction: server-computed breakdown/breakout signal and its reasons. This is the strongest short-term read.
- technicalIndicators: RSI, MACD, Bollinger %B, SMA distances, ADX regime, AND swing support/resistance levels + market structure (structureBias / structureEvent). Current state of momentum, trend structure, and the price levels that bound the 30-45d move (see the SUPPORT / RESISTANCE & MARKET STRUCTURE block above).
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

PASS criteria — apply BEFORE the IV regime logic below to skip the sleeve entirely. The derivatives sleeve is NOT obligated to find a trade; "no opinion" is a valid stance and routinely the right one for a conservative book.
- Conviction < 55 AND the derivatives panel does not cite an IV-HV premium → PASS. At coin-flip conviction with fairly-priced vol, neither credit nor debit has a structural edge.
- Panels in severe directional disagreement WITHIN THE SHORT-TERM SET — e.g. capital outflow + bullish technicals + sentiment euphoric → PASS. Signals too noisy to size a one-sided derivative bet, even a far-OTM credit one. NOTE: stock-sleeve long-term bullishness conflicting with short-term bearish signals is NOT this case — that is the normal time-horizon split and does NOT justify PASS (see derivatives.confidence scoring above).
- Direction "neutral" with conviction < 65 AND no IV-HV premium cited → PASS. No thesis to translate into premium-collection.
- The rationale MUST name which PASS criterion fired (e.g. "PASS: conviction 52 with derivatives panel IV-HV at parity — no edge in either direction").

PASS is NOT a fallback for an unverifiable prerequisite. SELL_PUT_SPREAD and SELL_CALL_SPREAD have NO cash gate and NO shares gate — their risk is the spread width minus credit. If the directional thesis is bullish-to-neutral with conviction ≥ 55, pick SELL_PUT_SPREAD; if bearish-to-neutral with conviction ≥ 55, pick SELL_CALL_SPREAD. Never PASS merely because you are unsure whether the user has cash or shares — that is exactly what the spreads are for.

If none of these fire, proceed to the IV regime rules below.

VOLATILITY IS THE PRIMARY DRIVER, NOT DIRECTION. In options trading, direction is a commodity but volatility is a math problem. Always check vega exposure BEFORE direction.

VOLATILITY NUMBERS — SERVER-COMPUTED, AUTHORITATIVE:
The derivatives panel's FIRST TWO bullets (when present) carry hard numbers computed from moomoo IV at the closest-to-spot strike (~30 DTE expiry) and yfinance close-to-close HV30 × sqrt(252). The shapes are:
  Bullet 1: "Vol baseline: ATM IV {x}% ({N}d), HV30 {y}%, IV/HV {r} — {regime_label}."
  Bullet 2: "25Δ skew: put IV {a}% vs call IV {b}% = {±z}pp {skew_label}."
PARSE these numbers directly. Do NOT infer IV-HV premium or skew from the anomaly-class bullets when the Vol baseline bullet is present — the server numbers win, even if the anomaly text disagrees. If the Vol baseline bullet says "unavailable", fall back to the anomaly text's qualitative description and lower confidence on vol-driven decisions.

IV regime → required vega direction (non-negotiable):
- IV percentile HIGH (>~70): credit trades are mathematically rich. MATCH THE CREDIT TRADE TO YOUR DIRECTIONAL BIAS — high IV does NOT default to bullish.
  - Bullish-to-neutral bias → SELL_PUT_SPREAD, or SELL_CASH_SECURED_PUT with the cash caveat stated. Both capture put-side premium.
  - Bearish-to-neutral bias → SELL_CALL_SPREAD, or SELL_COVERED_CALL with the shares caveat stated. Both capture call-side premium.
- IV percentile LOW (<~30) — OR, when no percentile is available, IV/HV < ~0.9 (the Vol baseline bullet labels this "IV discount to realized"): premium is cheap RELATIVE TO THE MOVEMENT THE STOCK IS ACTUALLY DELIVERING — selling credit gives a thin reward for the risk being realized. This is a negative-vol-edge environment for a premium seller: the conservative default is PASS. Only commit to a credit spread when conviction ≥ 70 AND directional support is strong AND the short strike clears both the support/resistance level and the expectedMove bound. See the IV-HV DISCOUNT GUARD below.
- IV middle (~30-70): credit spreads remain the only structures on the menu. Pick CREDIT matched to the directional bias when conviction ≥ 55. Skip the trade (PASS) if conviction < 55 AND IV-HV is at parity.

IV-HV check (mandatory when IV percentile is mid-to-high) — tiered, matches the user's Spread Checklist:
- IV/HV ≥ 1.2× (REQUIRED tier): options are paying more than realized. The derivatives panel cites this when IV exceeds HV by ~20% or more, often phrased as "IV slightly elevated vs HV" or "IV-HV溢价". Treat this as the minimum "premium is rich" signal — credit selling has positive expected value vs. realized movement.
- IV/HV ≥ 1.5× (PREFERRED tier): the implied-vs-realized gap is wide enough that IV mean-reversion alone gives positive EV before any directional move. Lean in here.
- IV/HV ≥ 2× (IDEAL tier): the "IV-HV高额溢价" / "implied >> realized by 2x+" case. SELLING premium is mathematically favored REGARDLESS of directional bias.
- IV ≈ HV (0.9× ≤ ratio < 1.2×): vol is fair-priced — treat as "no IV-HV premium" for PASS-criterion purposes; lean on direction alone.
- IV-HV DISCOUNT GUARD — IV/HV < ~0.9× (IV BELOW realized; the Vol baseline labels it "IV discount to realized"): this is NOT "no premium, just trade direction." It is an ACTIVE warning that the market is pricing LESS movement than the stock is realizing, so a credit seller is structurally UNDERPAID for the actual risk — negative vol edge, AND the wide realized move makes the short strike easier to breach. For this credit-only book the default here is PASS, even when the directional read is clean (a bearish thesis at IV/HV 0.72 routes to PASS, NOT SELL_CALL_SPREAD). Override to a credit spread ONLY when ALL of: conviction ≥ 75, and the short strike sits beyond BOTH the relevant support/resistance level AND the expectedMove 1-SD bound. The rationale MUST cite the ratio and name the guard (e.g. "IV/HV 0.72 — IV discount to realized; underpaid to sell premium into a wide realized move → PASS").
- Do NOT require the explicit "高额溢价" phrasing. Any panel language indicating IV > HV at any magnitude ≥ 1.2× counts as an IV-HV premium for the PASS / regime logic above.

Skew check (mandatory; uses 25Δ skew from the Vol baseline bullet):
- 25Δ skew ≥ +0.03 (put IV richer than call IV by ≥3 vol points): put skew elevated, market paying up for crash protection. Put-side credit becomes structurally more attractive — you're collecting that fear premium. Rationale MUST cite the numeric skew (e.g. "25Δ put skew +4.1pp — sellers paid to provide downside insurance").
- 25Δ skew ≤ -0.03 (call IV richer than put IV; uncommon, often signals melt-up positioning or upcoming-merger excitement): call-side credit collects the right-tail premium.
- 25Δ skew between -0.03 and +0.03: skew balanced; don't weight the decision on skew.

Leveraged-ETF rule (overrides bullish-credit/bearish-credit defaults):
- For daily-reset 3x leveraged ETFs (TQQQ, SQQQ, SOXL, SOXS, UPRO, SPXU, SPXL, SPXS, FAS, FAZ, TNA, TZA, LABU, LABD, NUGT, DUST, JNUG, JDST, BOIL, KOLD, and similar 2x/3x leveraged products): PREFER the spread variants. Specifically: bullish-to-neutral → SELL_PUT_SPREAD (NOT SELL_CASH_SECURED_PUT); bearish-to-neutral → SELL_CALL_SPREAD (NOT SELL_COVERED_CALL).
- Reason: these products have built-in volatility decay from the daily-reset mechanic. Holding them via assignment (CSP) or via the underlying stock leg (covered call) inherits that decay. The defined-risk spreads cap the loss at (width × 100) − credit and never require holding the leveraged product through assignment.
- The rationale MUST cite the leveraged-ETF rule by name when this override fires (e.g. "switching from CSP to SELL_PUT_SPREAD because SOXL is a 3x leveraged ETF — daily-reset decay makes assignment a structurally bad outcome").

- Options DTE rule: stick to ~30-45 DTE for new entries. Income trades (CSP / credit spreads / covered call) can extend to 45-60 DTE for richer theta.

- EX-DIVIDEND EARLY-ASSIGNMENT GUARD: the fundamentals panel's [Calendar] bullet / meta may carry an "ex-div {YYYY-MM-DD}" date. A short call that goes ITM into ex-div is the classic early-exercise surprise — the counterparty exercises to capture the dividend. For NEW bearish entries when ex-div falls inside the expiry window, prefer SELL_CALL_SPREAD (defined risk if assigned) over SELL_COVERED_CALL, and say in the instruction to keep the short call comfortably OTM. Ex-div is NOT a constraint on put-side trades. When no ex-div date is present, this guard is inert.

EXPECTED MOVE & STRIKE PLACEMENT (payload field: \`expectedMove\` — server-computed; null = skip this section):
The market's own 1-standard-deviation range over the ~30 DTE expiry, derived from ATM IV: \`move\` = spot × atmIv × sqrt(dte/365). Fields: \`move\` (absolute $), \`movePct\` (± % of spot), \`upper\`/\`lower\` (the 1-SD bounds), \`dte\`, \`atmIv\`. This is the SINGLE most important number for placing a defined-risk short strike — direction and POP are downstream of it. You are not fed the option chain, so you do NOT pick exact strikes or quote a numeric POP; instead reason about WHERE the safe strike sits relative to this range.
- The conservative edge is a short strike OUTSIDE the expected move. Cross-check it against the support/resistance levels from technicalIndicators: a bullish SELL_PUT_SPREAD / CSP wants its short put below BOTH \`support\` AND \`expectedMove.lower\`; a bearish SELL_CALL_SPREAD wants its short call above BOTH \`resistance\` AND \`expectedMove.upper\`. The level only protects you if it sits beyond the implied range.
- When the relevant support/resistance level is INSIDE the expected move (support > \`lower\`, or resistance < \`upper\`), the technically-"safe" strike is statistically exposed — the market prices a >1-SD chance of breaching it. Respond by widening (push the short strike further OTM, toward the ~0.15Δ guidance) or PASS. Say so in the rationale.
- A WIDE expected move (high \`movePct\`, e.g. > ~10% on a large-cap) means rich premium but also a real chance of a big adverse move — favor farther-OTM short strikes; a NARROW expected move (low \`movePct\`) means thin premium — only sell it with strong conviction, else PASS (this overlaps the low-IV PASS logic).
- When expectedMove materially shapes the call, CITE it in the rationale verbatim (e.g. "expected move ±$14.20 (±7.1%) over 33 DTE puts the 1-SD lower bound at $185.80, below support $188 — bull-put short strike has room"). Do NOT invent your own move number; use the field.

adjustment.instruction (derivatives sleeve): plain English describing the play. Example: "Sell a 30-45 DTE bull put spread with the short leg far OTM (Δ 0.15-0.20). Take profit at 50% of max; close at 21 DTE if it hasn't hit target." Describe DTE band + structure + management plan. DO NOT include specific strike prices, premium amounts, contract counts, or "% NAV" — strike selection happens at the broker at execution time, and you have no NAV to size against. DO include the standard management plan (take profit at ~50% of max credit; be out by ~21 DTE) because that is size-independent.

---

Time-horizon rule: stock-direction and derivatives-direction operate on different timeframes and may legitimately disagree. The stock sleeve reflects multi-week to multi-quarter conviction; the derivatives sleeve reflects the 30-45 DTE window. When they disagree, the rationale MUST name both stances explicitly — e.g. "long-term bullish (stock OPEN for accumulation) but short-term bearish (technical breakdown, insider selling, bearish peer read-through) → SELL_CALL_SPREAD to capture premium during the near-term weakness." Do NOT force alignment between the two sleeves.

rationale (3-5 sentences): cite the panel summaries by name and quote concrete signals (e.g. "capital panel: 4 sessions of major-capital outflow"; "derivatives panel: PCR pct 89, put block trades at 165"; "fundamentals panel: rev +24% YoY, fwd P/E 22 vs sector 30"). No vague adjectives — reference numbers. Tie BOTH sleeve actions back to specific signals. Always include at least one fundamentals reference when the fundamentals panel is non-n/a.

riskFactor: one sentence — the single thing that, if it happens, invalidates BOTH sleeve calls.

Peer read-through (the news panel's \`readThrough[]\`): the news panel may carry sector-peer events tagged with a read-through direction FOR this ticker. Treat these as a RISK OVERLAY / tiebreaker, NOT a primary driver — the ticker's own panels set the thesis. Specifically:
- A bearish + "competitive" read-through is a caution flag against selling premium on this name: prefer wider spreads or PASS. It must NOT, on its own, flip an otherwise-bullish verdict bearish.
- "shared-input" read-throughs (a common supplier/cost/regulatory shock — e.g. TSMC pricing, HBM supply, export rules) can hit the whole sleeve; weight them more heavily and name them in riskFactor when material.
- "sector-sentiment" read-throughs are soft context only.
Cite the peer ticker + event whenever a read-through influences the call.

Insider activity (the \`insider\` panel — SEC Form 4 disclosures): treat this as a CONVICTION OVERLAY on direction and on premium-selling risk, NOT a standalone thesis-driver.
- ONLY DISCRETIONARY open-market trades carry signal. The panel splits selling into "Disc. Sells" (discretionary, conviction) and "Routine" (Rule 10b5-1 pre-scheduled plan sales). For a large-cap, insider selling is almost always dominated by routine 10b5-1 diversification — that is NORMAL and NOT bearish. Read the panel's "Net Conviction" chip (buys − discretionary sells), NOT gross selling.
- A cluster of DISTINCT insiders buying open-market is a genuine bullish tell — it supports a bullish-to-neutral SELL_PUT_SPREAD / CSP bias and can raise conviction a notch. Meaningful DISCRETIONARY selling (large fraction of an insider's stake, or a cluster of distinct discretionary sellers) leans bearish and is a caution flag against selling downside premium (bull put / CSP) — prefer the bear-side credit, wider strikes, or PASS.
- DO NOT treat routine 10b5-1 plan selling or comp plumbing (option-exercise, tax-withholding, grants, gifts) as bearish — even when the gross dollar figure is large. A CEO's pre-scheduled plan sale or exercise-and-sell-to-cover is not conviction. When the insider panel's direction is "neutral" because selling is all routine, it neither helps nor hurts — say nothing about it (do NOT cite gross selling as a risk).
- Insider flow NEVER, on its own, flips a verdict that the price/flow/fundamentals panels set. It adjusts conviction at the margin. When it does influence the call, cite the DISCRETIONARY figure (e.g. "insider panel: 2 discretionary sells totaling $71M at >25% of stake, zero buys — widening the bull put spread"), and explicitly disregard routine plan selling.

Hard rules:
- NEVER state a position size, contract count, share count, dollar risk, or "% NAV" — you have no portfolio data.
- NEVER assume the user holds shares, options, or cash. When a strategy needs one, state the prerequisite as a condition in the instruction.
- Don't invent panel facts — only cite what the panels actually say.`;

// ---------- input shaping ----------

export interface SynthInput {
  ticker: string;
  symbol: string;
  snapshot: SnapshotResult | null;
  // Deterministic price-action breakdown/breakout signal (falling-knife guard).
  // Null when the sidecar is unavailable — the guard then no-ops.
  priceAction: PriceAction | null;
  // Standing technical-indicator state (RSI/MACD/Bollinger/SMA distances),
  // server-computed. Complements the technical panel's anomaly EVENTS with the
  // current STATE (e.g. overbought). Null when the sidecar is unavailable.
  technicalIndicators: TechnicalIndicators | null;
  // Deterministic 1-SD expected move over the ~30 DTE expiry (from ATM IV).
  // Server-computed via computeExpectedMove(volSummary). Null when the vol
  // snapshot is unavailable — the expected-move check then no-ops.
  expectedMove?: ExpectedMove | null;
  // Raw ATM-IV / HV30 ratio from the vol snapshot. < ~0.9 = "IV discount to
  // realized" — credit selling is underpaid. Drives the deterministic IV-HV
  // discount guard in synthesizeVerdict. Null when the snapshot is unavailable.
  ivHvRatio?: number | null;
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

function buildPrompt(input: SynthInput): string {
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
    // Deterministic falling-knife / melt-up guard (server-computed price action).
    // See the FALLING-KNIFE / MOMENTUM GUARD section in SYSTEM_INSTRUCTION.
    priceAction: compressPriceAction(input.priceAction),
    // Standing technical-indicator readings (RSI/MACD/Bollinger/SMA distances).
    // See the TECHNICAL INDICATOR STATE section in SYSTEM_INSTRUCTION.
    technicalIndicators: input.technicalIndicators ?? null,
    // Deterministic 1-SD expected move (ATM IV over ~30 DTE). See the EXPECTED
    // MOVE & STRIKE PLACEMENT section in SYSTEM_INSTRUCTION. Null = no-op.
    expectedMove: input.expectedMove ?? null,
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

// Strip any "% NAV" / share-count / contract-count fragments the model emits
// despite the prompt forbidding them. Without a portfolio feed these numbers
// are pure invention, so they get removed rather than recomputed.
// Order matters: peel off the wrapping phrase ("sized at X% NAV") before the
// bare "X% NAV" pattern, otherwise we leave dangling prepositions.
function stripSizingPhrases(s: string): string {
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
    // Stand-alone "(~N contracts)" / "(N shares)"
    .replace(/\(\s*~?\s*\d+\s+(?:contracts?|shares?)\s*\)/gi, " ")
    // Collapse whitespace + tidy punctuation
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

// Returns the dual-sleeve verdict fields only — the route attaches the panels
// (already known).
export async function synthesizeVerdict(input: SynthInput): Promise<Omit<Verdict, "panels">> {
  const raw = await genJson<RawVerdict>({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildPrompt(input),
    schema: VERDICT_RESPONSE_SCHEMA,
    temperature: 0.3,
  });

  // DEBUG: what the model GENERATED (raw, before the deterministic falling-knife
  // / IV-HV overrides below rewrite it). Compare against the MODEL INPUT log to
  // see exactly what the LLM is responsible for producing.
  if (process.env.SYNTH_DEBUG) {
    console.log(`\n[synth] ===== MODEL OUTPUT for ${input.ticker} (raw, pre-override) =====`);
    console.log(JSON.stringify(raw, null, 2));
  }

  let derivAction = raw.derivatives.action;
  let derivInstr = raw.derivatives.adjustment.instruction;

  // FALLING-KNIFE / MOMENTUM GUARD (deterministic enforcement). Runs before the
  // IV-HV guard and has the final say over derivAction alongside it. The prompt
  // instructs the model to self-apply this, but it sometimes sells premium into
  // the move anyway — this is the hard backstop.
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

  // IV-HV DISCOUNT GUARD (deterministic enforcement). When IV is materially
  // BELOW realized vol (IV/HV < 0.9), a credit seller is structurally underpaid
  // for the movement the stock is actually delivering — negative vol edge, and
  // the wide realized move makes the short strike easier to breach. The prompt
  // permits an override only at conviction ≥ 75 with the strike beyond both the
  // level and the expected move, but the model rationalizes around it (it cites
  // the 0.72 ratio, then sells "a small spread" anyway). Hard-backstop it: force
  // PASS on any credit entry below the conviction gate.
  const CREDIT_ENTRIES: DerivativesAction[] = [
    "SELL_PUT_SPREAD",
    "SELL_CALL_SPREAD",
    "SELL_CASH_SECURED_PUT",
    "SELL_COVERED_CALL",
    "IRON_CONDOR",
  ];
  const ivHv = input.ivHvRatio;
  if (
    ivHv != null &&
    ivHv < 0.9 &&
    raw.derivatives.confidence < 75 &&
    CREDIT_ENTRIES.includes(derivAction)
  ) {
    console.warn(
      `[synth] IV-HV DISCOUNT GUARD: model picked ${derivAction} at IV/HV ${ivHv.toFixed(2)} ` +
        `(IV discount to realized) with derivConfidence=${raw.derivatives.confidence} < 75 ` +
        `(${input.ticker}). Overriding to PASS.`,
    );
    derivInstr = `[Auto-corrected: IV-HV discount guard — IV/HV ${ivHv.toFixed(2)} (IV below realized) and derivatives conviction ${raw.derivatives.confidence} < 75. Underpaid to sell premium into a wider realized move; standing aside.] ${derivInstr}`;
    derivAction = "PASS";
  }

  const stock: SleeveVerdict<StockAction> = {
    action: raw.stock.action,
    direction: raw.stock.direction,
    confidence: raw.stock.confidence,
    adjustment: {
      ...raw.stock.adjustment,
      instruction: stripSizingPhrases(raw.stock.adjustment.instruction),
    },
  };
  const derivatives: SleeveVerdict<DerivativesAction> = {
    action: derivAction,
    direction: raw.derivatives.direction,
    confidence: raw.derivatives.confidence,
    adjustment: { ...raw.derivatives.adjustment, instruction: stripSizingPhrases(derivInstr) },
  };
  return {
    rationale: raw.rationale,
    riskFactor: raw.riskFactor,
    stock,
    derivatives,
    // Echo the standing technical state back so the client can display the
    // support/resistance/structure levels that fed this verdict.
    technicalIndicators: input.technicalIndicators ?? null,
  };
}
