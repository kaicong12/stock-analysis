import { getDb } from "../storage/db";
import type {
  CloseTradeInput,
  JournalLeg,
  JournalListFilter,
  JournalTrade,
  JournalTradeInput,
  JournalTradeWithLegs,
} from "./types";

interface TradeRow {
  id: number;
  ticker: string;
  strategy: string;
  status: "open" | "closed";
  expiry: string;
  dte_at_entry: number;
  net_credit: number;
  max_risk: number;
  contracts: number;
  thesis: string;
  mgmt_profit: string;
  mgmt_loss: string;
  closed_at: string | null;
  realized_pnl: number | null;
  exit_reason: string | null;
  ibkr_open_order_id: string | null;
  ibkr_close_order_id: string | null;
  created_at: string;
  updated_at: string;
}

interface LegRow {
  id: number;
  trade_id: number;
  side: "C" | "P";
  action: "BUY" | "SELL";
  strike: number;
  delta_at_entry: number | null;
  conid: number | null;
}

function rowToTrade(r: TradeRow): JournalTrade {
  return {
    id: r.id,
    ticker: r.ticker,
    strategy: r.strategy as JournalTrade["strategy"],
    status: r.status,
    expiry: r.expiry,
    dteAtEntry: r.dte_at_entry,
    netCredit: r.net_credit,
    maxRisk: r.max_risk,
    contracts: r.contracts,
    thesis: r.thesis,
    mgmtProfit: r.mgmt_profit,
    mgmtLoss: r.mgmt_loss,
    closedAt: r.closed_at,
    realizedPnl: r.realized_pnl,
    exitReason: r.exit_reason,
    ibkrOpenOrderId: r.ibkr_open_order_id,
    ibkrCloseOrderId: r.ibkr_close_order_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToLeg(r: LegRow): JournalLeg {
  return {
    id: r.id,
    tradeId: r.trade_id,
    side: r.side,
    action: r.action,
    strike: r.strike,
    deltaAtEntry: r.delta_at_entry,
    conid: r.conid,
  };
}

function getLegsForTrade(tradeId: number): JournalLeg[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM journal_legs WHERE trade_id = ? ORDER BY strike ASC, side ASC")
    .all(tradeId) as LegRow[];
  return rows.map(rowToLeg);
}

export function listTrades(filter?: JournalListFilter): JournalTradeWithLegs[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter?.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.ticker) {
    clauses.push("UPPER(ticker) = UPPER(?)");
    params.push(filter.ticker);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM journal_trades ${where} ORDER BY created_at DESC, id DESC`)
    .all(...params) as TradeRow[];
  return rows.map((r) => ({ ...rowToTrade(r), legs: getLegsForTrade(r.id) }));
}

export function getTrade(id: number): JournalTradeWithLegs | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM journal_trades WHERE id = ?").get(id) as TradeRow | undefined;
  if (!row) return null;
  return { ...rowToTrade(row), legs: getLegsForTrade(id) };
}

export function createTrade(input: JournalTradeInput): JournalTradeWithLegs {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.transaction(() => {
    const insertTrade = db.prepare(`
      INSERT INTO journal_trades (
        ticker, strategy, status, expiry, dte_at_entry,
        net_credit, max_risk, contracts, thesis, mgmt_profit, mgmt_loss,
        ibkr_open_order_id,
        created_at, updated_at
      ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = insertTrade.run(
      input.ticker,
      input.strategy,
      input.expiry,
      input.dteAtEntry,
      input.netCredit,
      input.maxRisk,
      input.contracts,
      input.thesis,
      input.mgmtProfit,
      input.mgmtLoss,
      input.ibkrOpenOrderId ?? null,
      now,
      now,
    );
    const tradeId = Number(info.lastInsertRowid);
    const insertLeg = db.prepare(`
      INSERT INTO journal_legs (trade_id, side, action, strike, delta_at_entry, conid)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const leg of input.legs) {
      insertLeg.run(tradeId, leg.side, leg.action, leg.strike, leg.deltaAtEntry, leg.conid);
    }
    return tradeId;
  })();
  const out = getTrade(result);
  if (!out) throw new Error(`createTrade: failed to read back trade ${result}`);
  return out;
}

export function updateTrade(
  id: number,
  patch: Partial<Omit<JournalTradeInput, "legs">>,
): JournalTradeWithLegs {
  const db = getDb();
  const fieldMap: Record<string, string> = {
    ticker: "ticker",
    strategy: "strategy",
    expiry: "expiry",
    dteAtEntry: "dte_at_entry",
    netCredit: "net_credit",
    maxRisk: "max_risk",
    contracts: "contracts",
    thesis: "thesis",
    mgmtProfit: "mgmt_profit",
    mgmtLoss: "mgmt_loss",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = fieldMap[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (!sets.length) {
    const existing = getTrade(id);
    if (!existing) throw new Error(`updateTrade: trade ${id} not found`);
    return existing;
  }
  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);
  const stmt = db.prepare(`UPDATE journal_trades SET ${sets.join(", ")} WHERE id = ?`);
  const info = stmt.run(...params);
  if (info.changes === 0) throw new Error(`updateTrade: trade ${id} not found`);
  const out = getTrade(id);
  if (!out) throw new Error(`updateTrade: failed to read back trade ${id}`);
  return out;
}

export function closeTrade(id: number, exit: CloseTradeInput): JournalTradeWithLegs {
  const db = getDb();
  const now = new Date().toISOString();
  const closedAt = exit.closedAt ?? now;
  const stmt = db.prepare(`
    UPDATE journal_trades
       SET status = 'closed',
           realized_pnl = ?,
           exit_reason = ?,
           closed_at = ?,
           ibkr_close_order_id = COALESCE(?, ibkr_close_order_id),
           updated_at = ?
     WHERE id = ? AND status = 'open'
  `);
  const info = stmt.run(
    exit.realizedPnl,
    exit.exitReason,
    closedAt,
    exit.ibkrCloseOrderId ?? null,
    now,
    id,
  );
  if (info.changes === 0) {
    throw new Error(`closeTrade: trade ${id} not found or already closed`);
  }
  const out = getTrade(id);
  if (!out) throw new Error(`closeTrade: failed to read back trade ${id}`);
  return out;
}

export function deleteTrade(id: number): void {
  const db = getDb();
  const info = db.prepare("DELETE FROM journal_trades WHERE id = ?").run(id);
  if (info.changes === 0) throw new Error(`deleteTrade: trade ${id} not found`);
}

export function getMonthlyPnL(year: number, month: number): { day: number; pnl: number }[] {
  const db = getDb();
  // Ensure month is 1-12. strftime('%Y-%m') expects 0-padded numbers.
  const monthStr = month.toString().padStart(2, "0");
  const yearStr = year.toString();
  const rows = db.prepare(`
    SELECT 
      CAST(strftime('%d', closed_at) AS INTEGER) as day,
      SUM(realized_pnl) as pnl
    FROM journal_trades
    WHERE status = 'closed'
      AND closed_at IS NOT NULL
      AND strftime('%Y-%m', closed_at) = ?
    GROUP BY day
    ORDER BY day ASC
  `).all(`${yearStr}-${monthStr}`) as { day: number; pnl: number }[];
  return rows;
}

