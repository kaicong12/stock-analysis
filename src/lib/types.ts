import type { HeldGroup } from "./positions/types";
export type { HeldGroup, HeldGroupKind, HeldSuggestion, HeldGroupTriggers } from "./positions/types";

export type AnomalyKind = "capital" | "technical" | "derivatives";

export interface AnomalyResult {
  kind: AnomalyKind;
  symbol: string;
  timeRange: number;
  content: string;
  raw: unknown;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publishTime: number;
  source?: string;
  imgUrl?: string;
}

export interface NewsResult {
  symbol: string;
  items: NewsItem[];
}

export interface DigestResult {
  symbol: string;
  items: NewsItem[];
}

// Morningstar research report (OpenD get_research_morningstar_report), the News
// Flow panel's self-signal. Flattened from the SDK's nested {context,...} shape
// by sidecar.getMorningstar — text fields are plain strings here. `available` is
// false when OpenD has no report for the code (unsupported asset, rate limit, or
// SDK too old); the panel then degrades to "n/a".
export interface MorningstarReport {
  symbol: string;
  available: boolean;
  starRating: number | null;          // 1-5; 4-5 undervalued, 3 fair, 1-2 overvalued
  ratingType: number | null;          // 0 unknown, 1 quantitative, 2 qualitative
  fairValue: number | null;
  fairValueNote: string;
  economicMoatLabel: string | null;   // "Wide" | "Narrow" | "None"
  uncertaintyLabel: string | null;    // "Low" | "Medium" | "High" | "Very High" | "Extreme"
  financialHealthLabel: string | null;
  capitalAllocationLabel: string | null;
  bullSay: string[];
  bearSay: string[];
  analystNoteTitle: string;
  analystNote: string;
  investmentThesis: string;
  valuationNote: string;
  starUpdateTimeStr: string | null;
  analystReportUpdateTimeStr: string | null;
  pdfUrl: string | null;
}

export interface CommentItem {
  id: string;
  title?: string;
  desc?: string;
  url: string;
  publishTime: number;
}

export interface CommentSentimentResult {
  symbol: string;
  posts: CommentItem[];
}

export interface SnapshotResult {
  symbol: string;
  name: string;
  lastPrice: number;
  prevClose: number;
  changePct: number;
  volume: number;
  updateTime: string;
  raw: Record<string, unknown>;
}

// Structured volatility snapshot from the sidecar's /options/vol-summary.
// All IV/HV values are decimals (0.32 = 32% annualized). Feeds the derivatives
// panel with hard numbers so the model doesn't have to infer IV regime,
// IV-HV premium, or skew from the anomaly report's prose.
export interface VolSummary {
  symbol: string;
  spot: number;
  expiryUsed: string;            // ISO date of the expiry sampled for IV
  dte: number;                   // actual DTE of expiryUsed
  atmIv: number | null;          // avg(call, put) IV at the closest-to-spot strike
  atmIvCall: number | null;
  atmIvPut: number | null;
  atmStrikeCall: number | null;
  atmStrikePut: number | null;
  hv30: number | null;           // 30 trading-day HV; sqrt(252)-annualized
  hv60: number | null;
  ivHvRatio: number | null;      // atmIv / hv30; >1.10 = meaningful IV premium
  skew25d: number | null;        // putIv(Δ≈-0.25) - callIv(Δ≈+0.25)
  skew25dCallStrike: number | null;
  skew25dPutStrike: number | null;
  hvSampleSize: number;
}

// Deterministic price-action / breakdown signal from the sidecar's /price-action
// (yfinance daily OHLCV). Feeds the verdict's "falling-knife guard": a confirmed
// `signal: "breakdown"` HARD-VETOES selling put spreads / CSPs into the decline;
// a `"breakout"` hard-vetoes selling call spreads / covered calls into a melt-up.
// All numbers are computed server-side so the guard can't be argued out of by a
// mean-reversion-happy technical panel. Null fields when bars are insufficient.
export type PriceActionSignal = "breakdown" | "breakout" | "none";

export interface PriceAction {
  symbol: string;
  signal: PriceActionSignal;
  severity: "severe" | "mild" | "none";
  reasons: string[];                 // human-readable triggers, e.g. "9.2% below 50d MA"
  spot: number | null;
  sma50: number | null;
  sma200: number | null;
  pctVsSma50: number | null;         // % above(+)/below(-) the 50-day SMA
  pctVsSma200: number | null;
  pctOffHigh20: number | null;       // % off the 20-day high (<= 0)
  atLow20: boolean;                  // within ~1% of the 20-day low
  atHigh20: boolean;                 // within ~1% of the 20-day high
  consecutiveDownDays: number;
  consecutiveUpDays: number;
  todayChangePct: number | null;     // latest close vs prior close
  gapPct: number | null;             // latest open vs prior close
  volRatio: number | null;           // latest volume / 20-day avg volume
  hv30: number | null;
  hv60: number | null;
  hvExpansion: number | null;        // hv30 / hv60; > 1 = realized vol expanding
  barsUsed: number;
}

// Standing technical-indicator readings from the sidecar's /technical/indicators
// (computed from cached daily OHLCV). Complements the technical ANOMALY feed
// (get_technical_unusual), which only fires on fresh cross/threshold EVENTS and
// is blind to a persistent state like "RSI has been > 70 for weeks". Null fields
// when there aren't enough bars for that indicator. Computed server-side, never
// via the LLM, so the figures the panel/verdict cite are exact.
export type RsiState = "overbought" | "oversold" | "neutral" | "n/a";

// Trend-regime classification (ADX-driven). Tells the verdict whether an
// overbought/oversold oscillator reading is actionable mean-reversion (range)
// or a momentum trap to NOT fade (trend). A strong ticker can ride overbought
// for weeks inside a strong_uptrend; a weak one bleeds oversold for weeks
// inside a strong_downtrend — neither is a reversal signal on its own.
export type TrendRegime =
  | "strong_uptrend"
  | "uptrend"
  | "range"
  | "downtrend"
  | "strong_downtrend"
  | "n/a";

// Regular RSI/price divergence — the actual exhaustion confirmation. "bearish"
// = price higher-high while RSI lower-high (overbought finally fading);
// "bullish" = price lower-low while RSI higher-low (oversold downtrend turning).
export type RsiDivergence = "bearish" | "bullish" | "none";

export interface TechnicalIndicators {
  symbol: string;
  spot: number | null;
  asOf: string | null;               // ISO date of the latest bar used
  barsUsed: number;
  rsi14: number | null;              // Wilder RSI(14); >=70 overbought, <=30 oversold
  rsiState: RsiState;
  macd: number | null;               // MACD line (EMA12 - EMA26)
  macdSignal: number | null;         // 9-period EMA of the MACD line
  macdHist: number | null;           // macd - signal; >0 bullish, <0 bearish
  bbUpper: number | null;            // Bollinger(20,2) upper band
  bbMid: number | null;              // 20-day SMA (band midline)
  bbLower: number | null;
  bbPctB: number | null;             // %B: >1 above upper band, <0 below lower
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  pctVsSma20: number | null;         // % above(+)/below(-) the 20-day SMA
  pctVsSma50: number | null;
  pctVsSma200: number | null;
  high52w: number | null;
  low52w: number | null;
  pctOff52wHigh: number | null;      // % off the 52-week high (<= 0)
  ret5d: number | null;              // 5-trading-day % return
  ret20d: number | null;             // 20-trading-day % return
  adx14: number | null;              // Wilder ADX(14); >=20 trending, >=35 strong
  plusDi: number | null;             // +DI at the latest bar (up-pressure)
  minusDi: number | null;            // -DI at the latest bar (down-pressure)
  regime: TrendRegime;               // ADX+DI+SMA-stack trend classification
  rsiDivergence: RsiDivergence;      // regular RSI/price divergence (exhaustion tell)
}

// Fundamentals from yfinance (via python sidecar). All numeric fields are
// nullable — yfinance returns sparse data for non-US listings, ETFs, and
// freshly-IPO'd names.
export interface FundamentalsData {
  shortName: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  earningsGrowth: number | null;          // YoY, decimal (0.12 = 12%)
  earningsQuarterlyGrowth: number | null; // QoQ, decimal
  revenueGrowth: number | null;           // YoY, decimal
  revenueTtm: number | null;
  profitMargins: number | null;           // decimal
  operatingMargins: number | null;        // decimal
  grossMargins: number | null;            // decimal
  debtToEquity: number | null;            // ratio (some sources express as %)
  totalDebt: number | null;
  totalCash: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;
  returnOnEquity: number | null;          // decimal
  returnOnAssets: number | null;          // decimal
  currentRatio: number | null;
  quickRatio: number | null;
  dividendYield: number | null;           // decimal (0.025 = 2.5%)
  payoutRatio: number | null;             // decimal
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currentPrice: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  recommendationKey: string | null;       // "buy" | "hold" | "sell" | "strong_buy" | "underperform" | ...
  numberOfAnalystOpinions: number | null;
  shortPercentOfFloat: number | null;     // decimal
  heldPercentInsiders: number | null;     // decimal
  heldPercentInstitutions: number | null; // decimal
  currency: string | null;
  nextEarningsDate: string | null;        // ISO date YYYY-MM-DD
}

export interface FundamentalsResult {
  symbol: string;
  yfTicker: string;
  data: FundamentalsData;
}

export type Currency = "SGD" | "USD" | "HKD" | "BASE" | string;

export interface Position {
  acctId: string;
  conid: number;
  contractDesc: string;
  position: number;
  avgCost: number;
  avgPrice: number;
  mktPrice: number;
  mktValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  currency: Currency;
  assetClass: string;
  expiry?: string | null;
  strike?: number | null;
  putOrCall?: string | null;
  multiplier?: string | null;
  underlyingConid?: number;
  // Populated by enrichWithLiveGreeks() for OPT positions only — drives the
  // verdict's defensive-roll logic ("your short put is now Δ -0.50").
  liveGreeks?: {
    delta: number | null;
    theta: number | null;
    vega: number | null;
    iv: number | null;
  };
}

export interface LedgerEntry {
  currency: Currency;
  cashBalance: number;
  netLiquidationValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  exchangeRate: number;
  stockMarketValue: number;
  optionMarketValue: number;
}

export interface PortfolioSummary {
  accountId: string;
  baseCurrency: Currency;
  netLiquidation: number;
  totalCash: number;
  availableFunds: number;
  buyingPower: number;
  initMarginReq: number;
  maintMarginReq: number;
  grossPositionValue: number;
  rawTimestamp: number;
}

export interface Portfolio {
  accountId: string;
  accountType: string;
  isPaper: boolean;
  baseCurrency: Currency;
  summary: PortfolioSummary;
  positions: Position[];
  ledger: LedgerEntry[];
}

// ----- Per-panel summary (output of each per-skill analyzer) -----

export type PanelDirection = "bullish" | "bearish" | "neutral" | "mixed" | "n/a";

export interface PanelEvidence {
  title: string;
  url: string;
}

export interface PanelMeta {
  label: string;
  value: string;
}

// A large-cap sector peer resolved from OpenD plates (sidecar /peers).
export interface PeerInfo {
  code: string;   // moomoo symbol, e.g. "US.NVDA"
  name: string | null;
  capBn: number;  // market cap in $B
  price: number;
}

export interface PeersResult {
  symbol: string;
  industryPlate: string | null;
  peers: PeerInfo[];
}

// One peer-news read-through entry in the News Flow panel's sub-block.
// Kept strictly separate from the self-news fields (direction/headline/etc.):
// peer news must never influence the panel's own-ticker direction.
export type ReadThroughClass = "sector-sentiment" | "competitive" | "shared-input";

export interface ReadThrough {
  peer: string;                  // peer ticker, e.g. "NVDA"
  classification: ReadThroughClass;
  direction: "bullish" | "bearish" | "neutral";  // read-through FOR the panel's ticker
  note: string;
  url: string;
}

// A peer-news item after the fan-out + collation step (httpApi.collatePeerNews).
export interface PeerNewsItem {
  source: string;     // peer ticker the item surfaced under
  title: string;
  url: string;
  publishTime: number;
}

// ----- Insider transactions (SEC Form 4 via Massive, ex-Polygon) -----

// One Form 4 transaction line, adapted from the vendor payload. `code` is the
// raw SEC transaction code (P/S/A/M/F/G/...); `isOpenMarket` is true only for
// P (open-market buy) and S (open-market sell) — the conviction trades.
export interface InsiderTransaction {
  name: string;
  title: string;
  code: string;
  typeLabel: string;        // human-readable code, e.g. "Buy (open mkt)"
  isOpenMarket: boolean;
  // True when the trade was made under a pre-scheduled Rule 10b5-1 plan
  // (aff_10b5_one). Plan sales are automatic/pre-committed and carry NO
  // directional conviction — the single most important field for reading
  // large-cap selling honestly (most mega-cap insider selling is 10b5-1).
  isPlan: boolean;
  // Discretionary = open-market AND not a 10b5-1 plan trade. The only sells
  // that carry a bearish signal; all open-market buys are discretionary.
  isDiscretionary: boolean;
  transactionDate: string;  // ISO YYYY-MM-DD
  filingDate: string;       // ISO YYYY-MM-DD
  shares: number;
  price: number;            // per-share; 0 for grants/exercises/gifts
  value: number;            // shares × price (vendor-provided when available)
  sharesOwnedAfter: number | null;
  // Fraction of the insider's post-trade stake that this trade represents:
  // shares / (shares + sharesOwnedAfter). A 60%-of-stake sell is conviction;
  // a 2%-of-stake sell is routine diversification. null when holdings unknown.
  pctOfHoldings: number | null;
  acquiredDisposed: string | null;  // "A" acquired / "D" disposed
}

// Deterministic aggregates over the window — computed in code, never by the LLM,
// so the figures the panel and verdict cite are always exact. The directional
// read keys off DISCRETIONARY flow (buys + non-plan sells); routine 10b5-1
// selling is tracked separately and excluded from the conviction signal.
export interface InsiderFlowSummary {
  buyCount: number;              // open-market BUY (code P) transactions (all discretionary)
  buyValue: number;              // total $ open-market bought
  distinctBuyers: number;        // distinct insiders buying open-market (cluster signal)
  // Discretionary (non-plan) open-market sells — the actual bearish signal.
  discSellCount: number;
  discSellValue: number;
  distinctDiscSellers: number;   // distinct discretionary sellers (cluster = stronger)
  // Routine Rule 10b5-1 pre-scheduled sells — tracked, but NOT a conviction signal.
  planSellCount: number;
  planSellValue: number;
  // Net CONVICTION value = buyValue − discSellValue (plan sells excluded).
  // Positive = net discretionary accumulation; negative = net discretionary selling.
  netConviction: number;
  totalFilings: number;          // all Form 4 rows in the window (incl. non-open-market)
}

export interface InsiderResult {
  ticker: string;
  transactions: InsiderTransaction[];  // full window, recency order
  notable: InsiderTransaction[];       // open-market-first, value-ranked, capped
  flow: InsiderFlowSummary;
}

// One row rendered in the insider panel's transaction sub-block. Attached to the
// PanelSummary in code (deterministic) — distinct from the LLM-authored bullets.
// `direction` drives the row colour: a routine 10b5-1 sell renders "neutral"
// (not red) so the user can see at a glance that it isn't a conviction signal.
export interface InsiderFlowItem {
  name: string;
  title: string;
  typeLabel: string;          // e.g. "Buy (open mkt)", "Sell (10b5-1)", "Sell (open mkt)"
  direction: "buy" | "sell" | "neutral";  // buy = P; sell = discretionary S; neutral = plan S / grant / exercise / etc.
  routine: boolean;           // true for 10b5-1 plan sells and comp plumbing
  date: string;
  shares: number;
  value: number;
  pctOfHoldings: number | null;  // fraction of stake traded (for discretionary trades)
}

export interface PanelSummary {
  headline: string;
  bullets: string[];
  direction?: PanelDirection;
  conclusion?: string;
  evidence?: PanelEvidence[];
  meta?: PanelMeta[];
  readThrough?: ReadThrough[];
  // Insider panel only: deterministic transaction rows attached in code (the LLM
  // writes the narrative; these carry the exact numbers the UI renders).
  insiderFlow?: InsiderFlowItem[];
}

// ----- Verdict — dual sleeve (stock half + derivatives half) -----

export type SleeveDirection = "bullish" | "bearish" | "neutral";

export type StockAction =
  | "OPEN"        // No position today; take a fresh directional position (direction tells the side).
  | "INCREASE"    // Add to existing stock position.
  | "TRIM"        // Sell part of existing stock position.
  | "HOLD"        // Keep stock position unchanged.
  | "CLOSE"       // Exit stock position entirely.
  | "PASS";       // No position, no entry — skip the stock sleeve.

export type DerivativesAction =
  | "SELL_PUT_SPREAD"        // Bullish CREDIT spread aka bull put spread (short higher put + long lower put). Cash-light CSP alternative.
  | "SELL_CALL_SPREAD"       // Bearish CREDIT spread aka bear call spread (short lower call + long higher call). No-shares covered-call alternative.
  | "SELL_COVERED_CALL"      // Income on existing stock holding (≥100 sh per contract).
  | "SELL_CASH_SECURED_PUT"  // Income / get-assigned-cheap, backed by available cash.
  | "IRON_CONDOR"            // Neutral CREDIT — bull put spread + bear call spread, same expiry. SHORT vega on both wings.
  | "ROLL_OUT"               // Defensive: close held leg(s), open later-expiry replacement(s) for net credit.
  | "INCREASE"               // Add to an existing option position.
  | "TRIM"                   // Sell part of an existing option position.
  | "HOLD"                   // Keep option position unchanged.
  | "CLOSE"                  // Exit option position entirely.
  | "PASS";                  // Skip the derivatives sleeve.

export interface PositionAdjustment {
  instruction: string;
  sizing?: string;
  entry?: string;
  stop?: string;
  target?: string;
  timeframe?: string;
  // Machine-readable size emitted by the synth model. The server uses these
  // to compute the actual % NAV and append a deterministic sizing footer to
  // `instruction`. The model is no longer trusted to write "~X% NAV" prose.
  sizeShares?: number;
  sizeContracts?: number;
}

export interface ContractLeg {
  contract: string;          // moomoo code, e.g. "US.AAPL240517C00175000"
  description: string;       // human-readable, e.g. "AAPL May 17 '24 175 CALL"
  side: "C" | "P";
  strike: number;
  expiry: string;            // ISO date
  last: number | null;
  // Live bid/ask from the chain snapshot. The contract picker's economics use
  // (bid+ask)/2 as the executable mid — these fields exist so the UI can show
  // the same mid on the leg row (otherwise `last` can be stale on OTM strikes
  // and the user sees "$2.20 − $1.29 = $0.91" while the spread credit is $2.10
  // from the live bid/ask mid).
  bid: number | null;
  ask: number | null;
  iv: number | null;
  delta: number | null;
  theta: number | null;
  vega: number | null;
  ratio?: number; // +1 for BUY, -1 for SELL in combo packaging
}

// Roll plan for ROLL_OUT — describes the close-old + open-new package as a
// single transaction. closingLegs come from the user's held positions (we know
// their conid + side); openingLegs come from the live chain.
export interface RollPlan {
  closingLegs: ContractLeg[];   // existing held legs being bought/sold to close
  openingLegs: ContractLeg[];   // new legs being opened in the same package
  closingCost: number;          // total debit to close (positive = pay)
  openingCredit: number;        // total credit on the new package (positive = receive)
  netRollCredit: number;        // openingCredit − closingCost; positive = good roll
  newMaxLoss: number;           // max loss on the new structure
  newMaxProfit: number;         // max profit on the new structure (incl. net roll credit)
  newBreakeven: number;
}

export interface ContractPick {
  strategy: DerivativesAction;
  longLeg?: ContractLeg;     // BUY_TO_OPEN — present for new-entry spreads
  shortLeg?: ContractLeg;    // SELL_TO_OPEN — present for new-entry spreads, covered call, CSP
  // Iron Condor 4-leg geometry. Present iff strategy === "IRON_CONDOR".
  longPutLeg?: ContractLeg;
  shortPutLeg?: ContractLeg;
  shortCallLeg?: ContractLeg;
  longCallLeg?: ContractLeg;
  netDebit?: number;         // for buys (spread cost)
  netCredit?: number;        // for premium-sells (covered call / CSP income)
  rollPlan?: RollPlan;       // present iff strategy === "ROLL_OUT"
  limitPrice: number;        // your fill target on the package (net for spreads/rolls)
  maxProfit: number;
  maxLoss: number;
  breakeven: number;             // legacy single-value field (= breakevenUpper for IC)
  breakevenLower?: number;       // IC only
  breakevenUpper?: number;       // IC only
  suggestedContracts: number;
  capitalRequired: number;   // total cash/margin for this trade
  // False when the chain returned no quotes for the picked legs — the dollar
  // fields above are zeroed, the strikes/expiry are still meaningful, and the
  // UI should render "—" instead of misleading numbers (chain quotes are the
  // only honest source for these economics; the LLM cannot infer them).
  quotesAvailable: boolean;
  ivPercentileNote: string;  // e.g. "IV pct 78 — selling premium favored"
  rationale: string;         // 1-2 sentences
  // Earnings-in-window flags. Server-computed in the picker after the model
  // has chosen the expiry: did fundamentals carry an earnings date, and does
  // the chosen expiry land at or after `nextEarningsDate − 2 days` (the
  // conservative "be out 2 days before earnings" buffer)? The UI surfaces a
  // warning when straddling; verdict generation may even refuse to recommend
  // a credit-spread trade in that case.
  nextEarningsDate?: string | null;     // raw ISO from fundamentals, or null
  earningsDaysAway?: number | null;     // integer days from today, or null
  earningsBufferDate?: string | null;   // nextEarningsDate − 2 days (ISO)
  earningsInWindow?: boolean;           // true = chosen expiry straddles the print
}

export interface SleeveVerdict<A extends string> {
  action: A;
  direction: SleeveDirection;
  confidence: number;          // conviction for this sleeve (0-100), assessed on its own time horizon
  adjustment: PositionAdjustment;
  contractPick?: ContractPick;  // derivatives sleeve only, only on new entries
}

export interface Verdict {
  rationale: string;           // 3-5 sentences, shared across both sleeves
  riskFactor: string;          // single biggest invalidator
  stock: SleeveVerdict<StockAction>;
  derivatives: SleeveVerdict<DerivativesAction>;
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

// ----- Option chain (input to the contract picker) -----

export interface OptionContract {
  // moomoo option code, e.g. "US.AAPL260610C250000". Used both as a stable id
  // (Gemini gets handed this and echoes it back to identify legs) and as the
  // key for moomoo's snapshot endpoint.
  code: string;
  side: "C" | "P";
  strike: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  oi: number | null;
  volume: number | null;
}

export interface OptionExpiry {
  expiry: string;       // ISO date
  dte: number;
  contracts: OptionContract[];
}

export interface OptionChain {
  symbol: string;
  spot: number;
  expiries: OptionExpiry[];
}

export interface DashboardData {
  ticker: string;
  symbol: string;
  generatedAt: string;
  snapshot: SnapshotResult | null;
  capital: AnomalyResult | null;
  technical: AnomalyResult | null;
  derivatives: AnomalyResult | null;
  news: NewsResult | null;
  digest: DigestResult | null;
  sentiment: CommentSentimentResult | null;
  fundamentals: FundamentalsResult | null;
  portfolio: Portfolio | null;
  heldPositions: Position[];
  heldGroups: HeldGroup[];
  verdict: Verdict | null;
  errors: { source: string; message: string }[];
}

// ----- Trade-logging modal payloads -----
//
// The repo used to place orders directly via IBKR's Client Portal. That code
// is gone — the user places trades in IBKR/TWS directly (more trustworthy
// quotes) and then comes back to log the trade in the journal. These types
// describe the input to that journal-logging flow.

// A leg of a closing transaction the user is about to log. Ratio is signed:
// +1 = was closed by BUY, -1 = was closed by SELL.
export interface JournalCloseLeg {
  side: "C" | "P";
  strike: number;
  expiry: string;            // ISO YYYY-MM-DD
  ratio: 1 | -1;
  lastPrice?: number | null;
}
