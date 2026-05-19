import { getDb } from "../storage/db";
import { env } from "../env";
import { fetchFlexTrades, type FlexTrade, type FlexErrorWithCode } from "../ibkr/flex";

export type AssetClassFilter = "STK" | "OPT" | "CASH" | "all";

export interface SyncStatus {
  queryId: string;
  lastSuccessAt: string | null;
  lastWindowTo: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  tradesSeen: number;
}

export interface SyncResult {
  status: "ok" | "skipped" | "error";
  reason?: "fresh" | "in_progress" | "not_configured" | "rate_limited";
  message?: string;              // human-readable detail (e.g. raw IBKR error)
  tradesUpserted: number;
  tradesInResponse: number;
  fromDate: string | null;
  toDate: string | null;
  syncStatus: SyncStatus;
}

interface SyncRow {
  query_id: string;
  last_success_at: string | null;
  last_window_to: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  trades_seen: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isWithinMs(iso: string | null, ms: number): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < ms;
}

function rowToStatus(row: SyncRow): SyncStatus {
  return {
    queryId: row.query_id,
    lastSuccessAt: row.last_success_at,
    lastWindowTo: row.last_window_to,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    tradesSeen: row.trades_seen,
  };
}

function loadOrInit(queryId: string): SyncRow {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM ibkr_flex_sync WHERE query_id = ?")
    .get(queryId) as SyncRow | undefined;
  if (existing) return existing;
  db.prepare("INSERT INTO ibkr_flex_sync (query_id) VALUES (?)").run(queryId);
  return {
    query_id: queryId,
    last_success_at: null,
    last_window_to: null,
    last_attempt_at: null,
    last_error: null,
    trades_seen: 0,
  };
}

export function getSyncStatus(): SyncStatus | null {
  if (!env.ibkrFlexQueryId) return null;
  const row = loadOrInit(env.ibkrFlexQueryId);
  return rowToStatus(row);
}

const UPSERT_SQL = `
  INSERT INTO ibkr_trades (
    transaction_id, account_id, trade_date, asset_category, symbol, description,
    conid, strike, expiry, put_call, multiplier, transaction_type, buy_sell,
    quantity, trade_price, proceeds, ib_commission, net_cash, open_close,
    fifo_pnl_realized, mtm_pnl, currency, ib_order_id, order_time, raw_json
  ) VALUES (
    @transaction_id, @account_id, @trade_date, @asset_category, @symbol, @description,
    @conid, @strike, @expiry, @put_call, @multiplier, @transaction_type, @buy_sell,
    @quantity, @trade_price, @proceeds, @ib_commission, @net_cash, @open_close,
    @fifo_pnl_realized, @mtm_pnl, @currency, @ib_order_id, @order_time, @raw_json
  )
  ON CONFLICT(transaction_id) DO UPDATE SET
    account_id        = excluded.account_id,
    trade_date        = excluded.trade_date,
    asset_category    = excluded.asset_category,
    symbol            = excluded.symbol,
    description       = excluded.description,
    conid             = excluded.conid,
    strike            = excluded.strike,
    expiry            = excluded.expiry,
    put_call          = excluded.put_call,
    multiplier        = excluded.multiplier,
    transaction_type  = excluded.transaction_type,
    buy_sell          = excluded.buy_sell,
    quantity          = excluded.quantity,
    trade_price       = excluded.trade_price,
    proceeds          = excluded.proceeds,
    ib_commission     = excluded.ib_commission,
    net_cash          = excluded.net_cash,
    open_close        = excluded.open_close,
    fifo_pnl_realized = excluded.fifo_pnl_realized,
    mtm_pnl           = excluded.mtm_pnl,
    currency          = excluded.currency,
    ib_order_id       = excluded.ib_order_id,
    order_time        = excluded.order_time,
    raw_json          = excluded.raw_json,
    updated_at        = CURRENT_TIMESTAMP
`;

function toUpsertParams(t: FlexTrade): Record<string, unknown> {
  return {
    transaction_id: t.transactionId,
    account_id: t.accountId,
    trade_date: t.tradeDate,
    asset_category: t.assetCategory,
    symbol: t.symbol,
    description: t.description,
    conid: t.conid,
    strike: t.strike,
    expiry: t.expiry,
    put_call: t.putCall,
    multiplier: t.multiplier,
    transaction_type: t.transactionType,
    buy_sell: t.buySell,
    quantity: t.quantity,
    trade_price: t.tradePrice,
    proceeds: t.proceeds,
    ib_commission: t.ibCommission,
    net_cash: t.netCash,
    open_close: t.openClose,
    fifo_pnl_realized: t.fifoPnlRealized,
    mtm_pnl: t.mtmPnl,
    currency: t.currency,
    ib_order_id: t.ibOrderId,
    order_time: t.orderTime,
    raw_json: t.raw,
  };
}

// One-day "fresh" window. We don't want to hammer Flex on every Calendar open
// once we've already pulled today's data, but a manual `force` retry bypasses
// it (UI button or after fixing the Flex Query in IBKR).
const FRESH_MS = 24 * 60 * 60 * 1000;
// Window during which we treat a recent (failed or in-flight) attempt as a
// reason to skip. IBKR's per-query cooldown after a rate-limit response is
// typically 5-10 minutes; 10 leaves margin without making manual retries feel
// stuck (the UI "Retry" button uses force=1 to bypass anyway).
const COOLDOWN_MS = 10 * 60 * 1000;

export async function syncTradesFromFlex(opts: { force?: boolean } = {}): Promise<SyncResult> {
  if (!env.ibkrFlexQueryId || !env.ibkrFlexToken) {
    return {
      status: "skipped",
      reason: "not_configured",
      tradesUpserted: 0,
      tradesInResponse: 0,
      fromDate: null,
      toDate: null,
      syncStatus: {
        queryId: env.ibkrFlexQueryId || "",
        lastSuccessAt: null,
        lastWindowTo: null,
        lastAttemptAt: null,
        lastError: "IBKR_FLEX_TOKEN or IBKR_FLEX_QUERY_ID missing",
        tradesSeen: 0,
      },
    };
  }

  const db = getDb();
  const queryId = env.ibkrFlexQueryId;
  let row = loadOrInit(queryId);

  if (!opts.force) {
    // Recent attempt without a matching success → another caller is mid-flight
    // OR IBKR is in cooldown after a rate-limit. Either way, don't hit Flex
    // again until COOLDOWN_MS has elapsed. The UI's manual Retry uses
    // force=1 to bypass.
    if (
      isWithinMs(row.last_attempt_at, COOLDOWN_MS) &&
      (!row.last_success_at || new Date(row.last_attempt_at!) > new Date(row.last_success_at))
    ) {
      return {
        status: "skipped",
        reason: "in_progress",
        tradesUpserted: 0,
        tradesInResponse: 0,
        fromDate: null,
        toDate: null,
        syncStatus: rowToStatus(row),
      };
    }
    if (isWithinMs(row.last_success_at, FRESH_MS)) {
      return {
        status: "skipped",
        reason: "fresh",
        tradesUpserted: 0,
        tradesInResponse: 0,
        fromDate: null,
        toDate: row.last_window_to,
        syncStatus: rowToStatus(row),
      };
    }
  }

  db.prepare("UPDATE ibkr_flex_sync SET last_attempt_at = ? WHERE query_id = ?").run(
    nowIso(),
    queryId
  );

  try {
    const result = await fetchFlexTrades();

    const upsert = db.prepare(UPSERT_SQL);
    let upserted = 0;
    const tx = db.transaction((trades: FlexTrade[]) => {
      for (const t of trades) {
        upsert.run(toUpsertParams(t));
        upserted++;
      }
    });
    tx(result.trades);

    db.prepare(
      `UPDATE ibkr_flex_sync
         SET last_success_at = ?,
             last_window_to  = ?,
             last_error      = NULL,
             trades_seen     = trades_seen + ?
       WHERE query_id = ?`
    ).run(nowIso(), result.toDate, upserted, queryId);

    row = loadOrInit(queryId);
    return {
      status: "ok",
      tradesUpserted: upserted,
      tradesInResponse: result.trades.length,
      fromDate: result.fromDate,
      toDate: result.toDate,
      syncStatus: rowToStatus(row),
    };
  } catch (e) {
    const err = e as FlexErrorWithCode;
    const msg = err.message ?? String(e);
    // IBKR's per-query cooldown is a non-2xx outcome from the caller's POV:
    // we accepted the sync request but didn't actually fetch anything. Don't
    // persist last_error (so the next successful pull silently clears it),
    // but pass the raw IBKR message back to the route so the UI can show
    // exactly what upstream said.
    if (err.transient) {
      row = loadOrInit(queryId);
      return {
        status: "error",
        reason: "rate_limited",
        message: msg,
        tradesUpserted: 0,
        tradesInResponse: 0,
        fromDate: null,
        toDate: null,
        syncStatus: rowToStatus(row),
      };
    }
    db.prepare("UPDATE ibkr_flex_sync SET last_error = ? WHERE query_id = ?").run(
      msg.slice(0, 500),
      queryId
    );
    row = loadOrInit(queryId);
    return {
      status: "error",
      tradesUpserted: 0,
      tradesInResponse: 0,
      fromDate: null,
      toDate: null,
      syncStatus: rowToStatus(row),
    };
  }
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  // `to` is exclusive — first day of the next month — so the SQL stays a clean
  // half-open range and we never have to think about month length.
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { from, to };
}

export interface DayPnl {
  day: number;
  pnl: number;
}

export function getMonthlyPnL(
  year: number,
  month: number,
  assetClass: AssetClassFilter = "all"
): DayPnl[] {
  const { from, to } = monthBounds(year, month);
  const db = getDb();
  // CASH rows are FX conversions, never real PnL — exclude them from the "all"
  // bucket so the calendar total matches what the IBKR mobile app shows.
  const classClause =
    assetClass === "all" ? "AND asset_category != 'CASH'" : "AND asset_category = ?";
  const sql = `
    SELECT trade_date AS date, SUM(fifo_pnl_realized) AS pnl
    FROM ibkr_trades
    WHERE trade_date >= ? AND trade_date < ?
    ${classClause}
    GROUP BY trade_date
    ORDER BY trade_date
  `;
  const params: unknown[] = [from, to];
  if (assetClass !== "all") params.push(assetClass);
  const rows = db.prepare(sql).all(...params) as Array<{ date: string; pnl: number | null }>;
  return rows.map((r) => ({
    day: Number(r.date.slice(8, 10)),
    pnl: r.pnl ?? 0,
  }));
}
