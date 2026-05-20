import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DB_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "ibkr-secdef.sqlite");

// Each entry is one schema version. user_version starts at 0 (fresh DB) and
// is stamped to MIGRATIONS.length after we apply pending migrations.
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE ibkr_underlying (
        symbol      TEXT PRIMARY KEY,
        conid       INTEGER NOT NULL,
        months_csv  TEXT NOT NULL,
        inserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE ibkr_strikes (
        underlying_conid INTEGER NOT NULL,
        month            TEXT NOT NULL,
        exchange         TEXT NOT NULL,
        call_strikes     TEXT NOT NULL,
        put_strikes      TEXT NOT NULL,
        inserted_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (underlying_conid, month, exchange)
      );

      CREATE TABLE ibkr_secdef_info (
        conid            INTEGER PRIMARY KEY,
        underlying_conid INTEGER NOT NULL,
        month            TEXT NOT NULL,
        strike           REAL NOT NULL,
        side             TEXT NOT NULL CHECK (side IN ('C','P')),
        maturity_date    TEXT NOT NULL,
        multiplier       TEXT,
        inserted_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_secdef_info_und_month ON ibkr_secdef_info (underlying_conid, month);
      CREATE INDEX idx_secdef_info_tuple    ON ibkr_secdef_info (underlying_conid, month, strike, side);
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE journal_trades (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker          TEXT NOT NULL,
        strategy        TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (status IN ('open','closed')) DEFAULT 'open',
        expiry          TEXT NOT NULL,
        dte_at_entry    INTEGER NOT NULL,
        iv_rank         REAL,
        net_credit      REAL NOT NULL,
        max_risk        REAL NOT NULL,
        contracts       INTEGER NOT NULL DEFAULT 1,
        thesis          TEXT NOT NULL,
        mgmt_profit     TEXT NOT NULL,
        mgmt_loss       TEXT NOT NULL,
        closed_at       TEXT,
        realized_pnl    REAL,
        exit_reason     TEXT,
        created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE journal_legs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id       INTEGER NOT NULL REFERENCES journal_trades(id) ON DELETE CASCADE,
        side           TEXT NOT NULL CHECK (side IN ('C','P')),
        action         TEXT NOT NULL CHECK (action IN ('BUY','SELL')),
        strike         REAL NOT NULL,
        delta_at_entry REAL,
        conid          INTEGER
      );

      CREATE INDEX idx_journal_trades_ticker_status ON journal_trades (ticker, status);
      CREATE INDEX idx_journal_legs_trade           ON journal_legs (trade_id);
    `);
  },
  (db) => {
    // Track the IBKR order ids that opened and closed the trade so the UI can
    // poll fill status and so we can reconcile journal entries against the
    // gateway's order history.
    db.exec(`
      ALTER TABLE journal_trades ADD COLUMN ibkr_open_order_id  TEXT;
      ALTER TABLE journal_trades ADD COLUMN ibkr_close_order_id TEXT;
    `);
  },
  (db) => {
    db.exec(`ALTER TABLE journal_trades DROP COLUMN iv_rank;`);
  },
  (db) => {
    // Tables for the IBKR Flex Query trade-sync pipeline. ibkr_trades stores
    // one row per executed fill, keyed by Flex's globally-unique transactionID
    // so the sync can be re-run any number of times safely. ibkr_flex_sync
    // tracks the last run so concurrent client triggers can short-circuit and
    // the UI can surface a staleness warning if the daily pull stops working.
    db.exec(`
      CREATE TABLE ibkr_trades (
        transaction_id     TEXT PRIMARY KEY,
        account_id         TEXT NOT NULL,
        trade_date         TEXT NOT NULL,
        asset_category     TEXT NOT NULL,
        symbol             TEXT NOT NULL,
        description        TEXT,
        conid              INTEGER,
        strike             REAL,
        expiry             TEXT,
        put_call           TEXT,
        multiplier         INTEGER,
        transaction_type   TEXT NOT NULL,
        buy_sell           TEXT NOT NULL,
        quantity           REAL NOT NULL,
        trade_price        REAL,
        proceeds           REAL,
        ib_commission      REAL,
        net_cash           REAL,
        open_close         TEXT,
        fifo_pnl_realized  REAL NOT NULL DEFAULT 0,
        mtm_pnl            REAL,
        currency           TEXT NOT NULL,
        ib_order_id        TEXT,
        order_time         TEXT,
        raw_json           TEXT NOT NULL,
        inserted_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_ibkr_trades_date  ON ibkr_trades(trade_date);
      CREATE INDEX idx_ibkr_trades_class ON ibkr_trades(asset_category, trade_date);

      CREATE TABLE ibkr_flex_sync (
        query_id         TEXT PRIMARY KEY,
        last_success_at  TEXT,
        last_window_to   TEXT,
        last_attempt_at  TEXT,
        last_error       TEXT,
        trades_seen      INTEGER NOT NULL DEFAULT 0
      );
    `);
  },
  (db) => {
    db.exec(`ALTER TABLE ibkr_trades ADD COLUMN fx_rate_to_base REAL;`);
  },
  (db) => {
    db.exec(`ALTER TABLE ibkr_trades ADD COLUMN date_time TEXT;`);
  },
];

function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    const tx = db.transaction(() => {
      MIGRATIONS[i](db);
      db.pragma(`user_version = ${i + 1}`);
    });
    tx();
  }
}

// Stash the handle on globalThis so Next.js dev HMR doesn't reopen the
// connection on every module reload.
const globalForDb = globalThis as unknown as { __ibkrDb?: Database.Database };

export function getDb(): Database.Database {
  if (globalForDb.__ibkrDb) return globalForDb.__ibkrDb;
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_FILE);
  // WAL: concurrent readers + single writer; durable on SIGKILL. NORMAL fsync
  // policy: lose at most the last in-flight transaction on power-loss, which
  // is fine for rebuildable reference data.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  globalForDb.__ibkrDb = db;
  process.once("exit", () => {
    try { db.close(); } catch { /* already closed */ }
  });
  return db;
}
