import type Database from "better-sqlite3";
import { getDb } from "../storage/db";

// Projected to the fields downstream consumers actually read. The IBKR
// `/iserver/secdef/info` response includes 17+ fields per row across 7
// exchange listings; we keep the canonical SMART listing and drop the rest.
export interface SecdefInfoRow {
  conid: number;
  underlyingConid: number;
  month: string;          // e.g. "MAY26"
  strike: number;
  right: "C" | "P";       // matches IBKR wire shape; SQL column is `side`.
  maturityDate: string;   // YYYYMMDD
  multiplier?: string;
}

interface UnderlyingDbRow {
  conid: number;
  months_csv: string;
}

interface StrikesDbRow {
  call_strikes: string;
  put_strikes: string;
}

interface SecdefInfoDbRow {
  conid: number;
  underlying_conid: number;
  month: string;
  strike: number;
  side: "C" | "P";
  maturity_date: string;
  multiplier: string | null;
}

// Lazy-prepared statements. Done lazily so this module's import doesn't
// trigger getDb() (and therefore migrations) at import time — the caller
// decides when the DB warms up.
let prepared: {
  selUnderlying: Database.Statement;
  insUnderlying: Database.Statement;
  selStrikes: Database.Statement;
  insStrikes: Database.Statement;
  selInfoByConid: Database.Statement;
  insInfo: Database.Statement;
} | null = null;

function stmts() {
  if (prepared) return prepared;
  const db = getDb();
  prepared = {
    selUnderlying: db.prepare(
      `SELECT conid, months_csv FROM ibkr_underlying WHERE symbol = ?`
    ),
    insUnderlying: db.prepare(
      `INSERT OR REPLACE INTO ibkr_underlying (symbol, conid, months_csv) VALUES (?, ?, ?)`
    ),
    selStrikes: db.prepare(
      `SELECT call_strikes, put_strikes FROM ibkr_strikes WHERE underlying_conid = ? AND month = ? AND exchange = ?`
    ),
    insStrikes: db.prepare(
      `INSERT OR REPLACE INTO ibkr_strikes (underlying_conid, month, exchange, call_strikes, put_strikes) VALUES (?, ?, ?, ?, ?)`
    ),
    selInfoByConid: db.prepare(
      `SELECT conid, underlying_conid, month, strike, side, maturity_date, multiplier
         FROM ibkr_secdef_info WHERE conid = ?`
    ),
    insInfo: db.prepare(
      `INSERT OR IGNORE INTO ibkr_secdef_info
         (conid, underlying_conid, month, strike, side, maturity_date, multiplier)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
  };
  return prepared;
}

export function getUnderlying(symbol: string): { conid: number; months: string[] } | null {
  const row = stmts().selUnderlying.get(symbol) as UnderlyingDbRow | undefined;
  if (!row) return null;
  return {
    conid: row.conid,
    months: row.months_csv ? row.months_csv.split(";").filter(Boolean) : [],
  };
}

export function putUnderlying(symbol: string, conid: number, months: string[]): void {
  // INSERT OR REPLACE so a re-fetch with newly-listed months overwrites the
  // stored months_csv. Conid never changes for a symbol, so the conid column
  // is effectively immutable.
  stmts().insUnderlying.run(symbol, conid, months.join(";"));
}

export function getStrikes(
  undConid: number,
  month: string,
  exchange: string,
): { call: number[]; put: number[] } | null {
  const row = stmts().selStrikes.get(undConid, month, exchange) as StrikesDbRow | undefined;
  if (!row) return null;
  return {
    call: JSON.parse(row.call_strikes) as number[],
    put: JSON.parse(row.put_strikes) as number[],
  };
}

export function putStrikes(
  undConid: number,
  month: string,
  exchange: string,
  call: number[],
  put: number[],
): void {
  stmts().insStrikes.run(undConid, month, exchange, JSON.stringify(call), JSON.stringify(put));
}

// Lookup by option conid — used for held positions where we know the conid
// but the IBKR portfolio endpoint didn't populate strike/expiry/right reliably.
export function getInfoByConid(conid: number): SecdefInfoRow | null {
  const row = stmts().selInfoByConid.get(conid) as SecdefInfoDbRow | undefined;
  if (!row) return null;
  return {
    conid: row.conid,
    underlyingConid: row.underlying_conid,
    month: row.month,
    strike: row.strike,
    right: row.side,
    maturityDate: row.maturity_date,
    multiplier: row.multiplier ?? undefined,
  };
}

export function getKnownInfoRows(undConid: number, months: string[]): SecdefInfoRow[] {
  if (!months.length) return [];
  const db = getDb();
  // IN-clauses with a variable list need per-call statements (better-sqlite3
  // doesn't support array binding for IN). Cheap to prepare; called once per
  // chain fetch.
  const placeholders = months.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT conid, underlying_conid, month, strike, side, maturity_date, multiplier
         FROM ibkr_secdef_info
        WHERE underlying_conid = ? AND month IN (${placeholders})`,
    )
    .all(undConid, ...months) as SecdefInfoDbRow[];
  return rows.map((r) => ({
    conid: r.conid,
    underlyingConid: r.underlying_conid,
    month: r.month,
    strike: r.strike,
    right: r.side,
    maturityDate: r.maturity_date,
    multiplier: r.multiplier ?? undefined,
  }));
}

export function insertInfoRows(rows: SecdefInfoRow[]): void {
  if (!rows.length) return;
  const db = getDb();
  const ins = stmts().insInfo;
  // INSERT OR IGNORE in one transaction. The UNIQUE constraint on conid
  // (PRIMARY KEY) makes duplicate inserts a no-op when an inflight-dedup
  // miss caused two concurrent fetchers to land the same conid.
  const tx = db.transaction((items: SecdefInfoRow[]) => {
    for (const r of items) {
      ins.run(
        r.conid,
        r.underlyingConid,
        r.month,
        r.strike,
        r.right,
        r.maturityDate,
        r.multiplier ?? null,
      );
    }
  });
  tx(rows);
}

// Escape hatch for the rare corporate-action case where a stored row no
// longer matches IBKR's reality. Callers: an admin/debug route, not the
// chain fetcher.
export function truncateSecdefStore(): void {
  const db = getDb();
  db.exec(`DELETE FROM ibkr_secdef_info; DELETE FROM ibkr_strikes; DELETE FROM ibkr_underlying;`);
}
