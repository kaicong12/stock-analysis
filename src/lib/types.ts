// Shared domain types for the dashboard: source payloads, panel summaries, and the verdict.

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

export interface MorningstarReport {
  symbol: string;
  available: boolean;
  starRating: number | null;          // 1-5; 4-5 undervalued, 3 fair, 1-2 overvalued
  ratingType: number | null;          // 0 unknown, 1 quantitative, 2 qualitative
  fairValue: number | null;
  fairValueNote: string;
  economicMoatLabel: string | null;
  uncertaintyLabel: string | null;
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

export interface VolSummary {
  symbol: string;
  spot: number;
  expiryUsed: string;
  dte: number;
  atmIv: number | null;          // decimal, annualized (0.32 = 32%)
  atmIvCall: number | null;
  atmIvPut: number | null;
  atmStrikeCall: number | null;
  atmStrikePut: number | null;
  hv30: number | null;           // 30 trading-day HV; sqrt(252)-annualized
  hv60: number | null;
  ivHvRatio: number | null;      // atmIv / hv30
  skew25d: number | null;        // putIv(Δ≈-0.25) - callIv(Δ≈+0.25)
  skew25dCallStrike: number | null;
  skew25dPutStrike: number | null;
  hvSampleSize: number;
}

export interface ExpectedMove {
  spot: number;
  atmIv: number;        // decimal, annualized (0.30 = 30%)
  dte: number;
  expiry: string;
  move: number;         // 1-SD absolute move in price terms
  movePct: number;      // percent, e.g. 8.4 = ±8.4%
  upper: number;
  lower: number;
}

export interface LevelsSnapshot {
  symbol: string;
  spot: number | null;
  asOf: string | null;
  expectedMove: ExpectedMove | null;
  support: number | null;
  resistance: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
}

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
  todayChangePct: number | null;
  gapPct: number | null;             // latest open vs prior close
  volRatio: number | null;           // latest volume / 20-day avg volume
  hv30: number | null;
  hv60: number | null;
  hvExpansion: number | null;        // hv30 / hv60; > 1 = realized vol expanding
  barsUsed: number;
}

export type RsiState = "overbought" | "oversold" | "neutral" | "n/a";

export type TrendRegime =
  | "strong_uptrend"
  | "uptrend"
  | "range"
  | "downtrend"
  | "strong_downtrend"
  | "n/a";

// "bearish" = price higher-high while RSI lower-high; "bullish" is the mirror.
export type RsiDivergence = "bearish" | "bullish" | "none";

export interface TechnicalIndicators {
  symbol: string;
  spot: number | null;
  asOf: string | null;
  barsUsed: number;
  rsi14: number | null;              // Wilder RSI(14); >=70 overbought, <=30 oversold
  rsiState: RsiState;
  macd: number | null;               // MACD line (EMA12 - EMA26)
  macdSignal: number | null;         // 9-period EMA of the MACD line
  macdHist: number | null;           // macd - signal
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
  plusDi: number | null;
  minusDi: number | null;
  regime: TrendRegime;
  rsiDivergence: RsiDivergence;
  support: number | null;
  resistance: number | null;
  supportLevels: number[];           // up to 3 zones, nearest below spot first
  resistanceLevels: number[];        // up to 3 zones, nearest above spot first
  structureBias: StructureBias;
  structureEvent: StructureEvent;
  structureDirection: SwingDirection;
  structureLevel: number | null;     // the swing level that was broken
}

export type StructureBias = "up" | "down" | "range" | "n/a";
// "BOS" continues the prevailing swing trend; "CHoCH" is the first break against it.
export type StructureEvent = "BOS" | "CHoCH" | "none";
export type SwingDirection = "up" | "down" | "n/a";

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
  exDividendDate: string | null;          // ISO date YYYY-MM-DD
}

export interface FundamentalsResult {
  symbol: string;
  yfTicker: string;
  data: FundamentalsData;
}

export type PanelDirection = "bullish" | "bearish" | "neutral" | "mixed" | "n/a";

export interface PanelEvidence {
  title: string;
  url: string;
}

export interface PanelMeta {
  label: string;
  value: string;
}

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

export type ReadThroughClass = "sector-sentiment" | "competitive" | "shared-input";

export interface ReadThrough {
  peer: string;                  // peer ticker, e.g. "NVDA"
  classification: ReadThroughClass;
  direction: "bullish" | "bearish" | "neutral";  // read-through FOR the panel's ticker
  note: string;
  url: string;
}

export interface PeerNewsItem {
  source: string;     // peer ticker the item surfaced under
  title: string;
  url: string;
  publishTime: number;
}

export interface PanelSummary {
  headline: string;
  bullets: string[];
  direction?: PanelDirection;
  conclusion?: string;
  prose?: string;             // Stock Digest only: web-grounded answer rendered verbatim as markdown
  evidence?: PanelEvidence[];
  meta?: PanelMeta[];
  readThrough?: ReadThrough[];
}

export type SleeveDirection = "bullish" | "bearish" | "neutral";

// Entry-or-pass only: with no broker feed there is no position to manage, so
// INCREASE / TRIM / HOLD / CLOSE / ROLL_OUT are deliberately not representable.
export type StockAction =
  | "OPEN"
  | "PASS";

// Wheel-only menu: no spreads, no condors, no naked or debit structures.
export type DerivativesAction =
  | "SELL_CASH_SECURED_PUT"
  | "SELL_COVERED_CALL"
  | "PASS";

// No NAV / cash / position data reaches the synth, so there is no size field.
export interface PositionAdjustment {
  instruction: string;
  sizing?: string;
  entry?: string;
  stop?: string;
  target?: string;
  timeframe?: string;
}

export interface SleeveVerdict<A extends string> {
  action: A;
  direction: SleeveDirection;
  confidence: number;          // 0-100, assessed on this sleeve's own time horizon
  adjustment: PositionAdjustment;
}

export interface Verdict {
  rationale: string;
  riskFactor: string;
  stock: SleeveVerdict<StockAction>;
  derivatives: SleeveVerdict<DerivativesAction>;
  technicalIndicators?: TechnicalIndicators | null;
  panels: {
    capital: PanelSummary;
    technical: PanelSummary;
    news: PanelSummary;
    digest: PanelSummary;
    sentiment: PanelSummary;
    fundamentals: PanelSummary;
  };
}

export type PanelKey = keyof Verdict["panels"];

export const PANEL_KEYS: PanelKey[] = [
  "fundamentals",
  "capital",
  "technical",
  "sentiment",
  "digest",
  "news",
];

export interface DashboardData {
  ticker: string;
  symbol: string;
  generatedAt: string;
  snapshot: SnapshotResult | null;
  capital: AnomalyResult | null;
  technical: AnomalyResult | null;
  news: NewsResult | null;
  sentiment: CommentSentimentResult | null;
  fundamentals: FundamentalsResult | null;
  verdict: Verdict | null;
  errors: { source: string; message: string }[];
}
