export type JournalStrategy =
  | "SELL_CASH_SECURED_PUT"
  | "SELL_COVERED_CALL"
  | "SELL_PUT_SPREAD"
  | "SELL_CALL_SPREAD"
  | "BUY_CALL_SPREAD"
  | "BUY_PUT_SPREAD"
  | "IRON_CONDOR"
  | "LONG_CALL"
  | "LONG_PUT"
  | "CUSTOM";

export type JournalStatus = "open" | "closed";

export interface JournalLegInput {
  side: "C" | "P";
  action: "BUY" | "SELL";
  strike: number;
  deltaAtEntry: number | null;
  conid: number | null;
}

export interface JournalLeg extends JournalLegInput {
  id: number;
  tradeId: number;
}

export interface JournalTradeInput {
  ticker: string;
  strategy: JournalStrategy;
  expiry: string;          // ISO YYYY-MM-DD
  dteAtEntry: number;
  ivRank: number | null;   // 0..100
  netCredit: number;       // $ per spread
  maxRisk: number;         // $ per spread
  contracts: number;
  thesis: string;
  mgmtProfit: string;
  mgmtLoss: string;
  ibkrOpenOrderId?: string | null;   // IBKR order id from the opening submission
  legs: JournalLegInput[];
}

export interface JournalTrade {
  id: number;
  ticker: string;
  strategy: JournalStrategy;
  status: JournalStatus;
  expiry: string;
  dteAtEntry: number;
  ivRank: number | null;
  netCredit: number;
  maxRisk: number;
  contracts: number;
  thesis: string;
  mgmtProfit: string;
  mgmtLoss: string;
  closedAt: string | null;
  realizedPnl: number | null;
  exitReason: string | null;
  ibkrOpenOrderId: string | null;
  ibkrCloseOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalTradeWithLegs extends JournalTrade {
  legs: JournalLeg[];
}

export interface CloseTradeInput {
  realizedPnl: number;     // signed total $
  exitReason: string;
  closedAt?: string;       // ISO timestamp; defaults to now
  ibkrCloseOrderId?: string | null;
}

export interface JournalListFilter {
  status?: JournalStatus;
  ticker?: string;         // case-insensitive match
}
