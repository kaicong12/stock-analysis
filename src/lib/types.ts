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

export interface PanelSummary {
  headline: string;
  bullets: string[];
  direction?: PanelDirection;
  conclusion?: string;
  evidence?: PanelEvidence[];
  meta?: PanelMeta[];
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
  | "BUY_CALL_SPREAD"        // Bullish debit spread (long call + short higher-strike call).
  | "BUY_PUT_SPREAD"         // Bearish debit spread (long put + short lower-strike put).
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
}

export interface ContractLeg {
  contract: string;          // moomoo code, e.g. "US.AAPL240517C00175000"
  description: string;       // human-readable, e.g. "AAPL May 17 '24 175 CALL"
  side: "C" | "P";
  strike: number;
  expiry: string;            // ISO date
  last: number | null;
  iv: number | null;
  delta: number | null;
  theta: number | null;
  vega: number | null;
  conid?: number;
  ratio?: number; // +1 for BUY, -1 for SELL in combo orders
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
}

export interface SleeveVerdict<A extends string> {
  action: A;
  direction: SleeveDirection;
  adjustment: PositionAdjustment;
  contractPick?: ContractPick;  // derivatives sleeve only, only on new entries
}

export interface Verdict {
  confidence: number;          // overall conviction in the directional read (0-100)
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
  };
}

// ----- Option chain (input to the contract picker) -----

export interface OptionContract {
  code: string;
  conid: number;
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

export interface OrderPayload {
  accountId: string;
  symbol: string;
  pick: ContractPick;
  tif: "DAY" | "GTC";
  outsideRTH: boolean;
}
