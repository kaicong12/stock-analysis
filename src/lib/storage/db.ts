import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DB_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "app.sqlite");

// Each entry is one schema version. user_version starts at 0 (fresh DB) and
// is stamped to MIGRATIONS.length after we apply pending migrations.
//
// IMPORTANT: never delete or reorder a migration even after the schema it
// creates is removed. The user_version pragma tracks an integer offset into
// this array — shifting indices would re-run later migrations against an
// already-evolved DB. Migrations whose tables are no longer used should be
// replaced with a no-op (see slot 0 below).
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // Was the IBKR secdef cache (ibkr_underlying / ibkr_strikes / ibkr_secdef_info).
  // Replaced by moomoo's get_option_chain — chain data is fetched fresh per
  // request and not persisted. The tables were dropped manually; this slot
  // stays as a no-op so user_version sequencing is preserved across upgrades.
  () => {},
  // Slots 1-6 built the trade journal (journal_trades / journal_legs) and the
  // IBKR Flex trade-sync pipeline (ibkr_trades / ibkr_flex_sync). Both features
  // are gone — the broker integration was removed and the journal with it. The
  // slots are no-ops rather than deletions so user_version sequencing survives;
  // the final migration drops whatever an existing DB still carries.
  () => {},
  () => {},
  () => {},
  () => {},
  () => {},
  () => {},
  (db) => {
    // Daily closes cache for the python sidecar's HV computation. The sidecar
    // (a separate process) reads + writes these tables directly via sqlite3 —
    // the file is shared, WAL mode handles concurrent access. We use
    // CREATE TABLE IF NOT EXISTS here (atypical for migrations) because the
    // sidecar may have run first and created the tables defensively on its
    // own startup; the schema is identical either way.
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_closes (
        yf_ticker   TEXT NOT NULL,
        close_date  TEXT NOT NULL,
        close       REAL NOT NULL,
        PRIMARY KEY (yf_ticker, close_date)
      );

      CREATE TABLE IF NOT EXISTS daily_closes_sync (
        yf_ticker          TEXT PRIMARY KEY,
        last_refresh_date  TEXT NOT NULL,
        bars_count         INTEGER NOT NULL DEFAULT 0
      );
    `);
  },
  (db) => {
    // Drop the journal + IBKR Flex tables. A DB created before this migration
    // still has them (slots 1-6 built them and are now no-ops); a fresh DB never
    // created them, hence IF EXISTS. journal_legs goes first — it has an FK onto
    // journal_trades.
    db.exec(`
      DROP TABLE IF EXISTS journal_legs;
      DROP TABLE IF EXISTS journal_trades;
      DROP TABLE IF EXISTS ibkr_trades;
      DROP TABLE IF EXISTS ibkr_flex_sync;
    `);
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
const globalForDb = globalThis as unknown as { __appDb?: Database.Database };

export function getDb(): Database.Database {
  if (globalForDb.__appDb) return globalForDb.__appDb;
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_FILE);
  // WAL: concurrent readers + single writer; durable on SIGKILL. NORMAL fsync
  // policy: lose at most the last in-flight transaction on power-loss, which
  // is fine for rebuildable reference data.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  globalForDb.__appDb = db;
  process.once("exit", () => {
    try { db.close(); } catch { /* already closed */ }
  });
  return db;
}
