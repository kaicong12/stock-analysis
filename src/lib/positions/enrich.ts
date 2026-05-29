// Held-option expiry enrichment.
//
// IBKR's /portfolio/{accountId}/positions/{page} endpoint inconsistently
// populates the expiry field on OPT rows. adaptPosition's contractDesc
// fallback ("AAPL JUN2026 260 P") only carries month + year, so it
// computes the third Friday — correct for monthly equity options, wrong
// for the weeklies a user actually holds (Jun05, Jun12, …). All three
// downstream consumers — the rail label, the synth's positionManagement
// block, and the dteUnder21 trigger — silently see the wrong DTE.
//
// Fix: look up the held option's real maturity by its conid via
// /iserver/secdef/info. The response includes one row per (strike, right,
// month) and per exchange listing — we project to the canonical SMART row
// per conid and persist into the secdef store. After the first lookup all
// further enrichments for that contract are free DB hits, and any chain
// fetch that later asks for the same (underlying, month, strike, right)
// is also pre-warmed.

import { ensureIserverBridge, ibkr } from "../ibkr/client";
import type { Position } from "../types";

// In-memory cache of (conid → SecdefInfoRow). Held-position expiry enrichment
// is the only remaining caller of IBKR's secdef/info, and the previous SQLite
// store was sized for the now-deleted option-chain fetcher. A per-process Map
// is the right shape for portfolio refreshes.
interface SecdefInfoRow {
  conid: number;
  underlyingConid: number;
  month: string;
  strike: number;
  right: "C" | "P";
  maturityDate: string;
  multiplier?: string;
}

const INFO_BY_CONID = new Map<number, SecdefInfoRow>();

function getInfoByConid(conid: number): SecdefInfoRow | undefined {
  return INFO_BY_CONID.get(conid);
}

function insertInfoRows(rows: SecdefInfoRow[]): void {
  for (const r of rows) INFO_BY_CONID.set(r.conid, r);
}

interface RawSecdefInfoRow {
  conid: number;
  strike: number;
  right: "C" | "P";
  maturityDate: string;
  multiplier?: string;
  exchange?: string;
}

const MONTH_THREE_OK = new Set([
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]);

interface DescParts {
  monthThree: string; // "JUN"
  year: number;       // 2026
  strike: number;
  right: "C" | "P";
}

function parseDesc(desc: string): DescParts | null {
  const parts = desc.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const m = /^([A-Z]{3})(\d{4})$/.exec(parts[1]);
  if (!m || !MONTH_THREE_OK.has(m[1])) return null;
  const year = Number(m[2]);
  const strike = Number(parts[2]);
  const right = parts[3];
  if (!Number.isFinite(year) || !Number.isFinite(strike) || strike <= 0) return null;
  if (right !== "C" && right !== "P") return null;
  return { monthThree: m[1], year, strike, right };
}

// IBKR /iserver/secdef/info expects "JUN26" (2-digit year) — same shape
// returned by /iserver/secdef/search and used throughout the chain fetcher.
function monthCode(monthThree: string, year4: number): string {
  return `${monthThree}${String(year4).slice(2)}`;
}

// "20260612" → "2026-06-12". Returns the input unchanged when it doesn't
// match the IBKR YYYYMMDD shape so a malformed maturity surfaces visibly.
function maturityToIso(maturity: string): string {
  if (maturity.length !== 8) return maturity;
  return `${maturity.slice(0, 4)}-${maturity.slice(4, 6)}-${maturity.slice(6, 8)}`;
}

// Fetch every weekly expiry at one (strike, right, month). The response
// includes one row per exchange listing per weekly conid — collapse to
// the canonical SMART listing per conid before returning so the store
// schema matches what the chain fetcher inserts.
async function fetchInfoForBucket(
  undConid: number,
  month: string,
  strike: number,
  right: "C" | "P",
): Promise<SecdefInfoRow[]> {
  const params = new URLSearchParams({
    conid: String(undConid),
    sectype: "OPT",
    month,
    strike: String(strike),
    right,
  });
  const rows = await ibkr<RawSecdefInfoRow[]>(`/iserver/secdef/info?${params}`);
  if (!rows?.length) return [];
  // For each conid keep the SMART-exchange row when present, else the first.
  const byConid = new Map<number, RawSecdefInfoRow>();
  for (const r of rows) {
    if (typeof r.conid !== "number") continue;
    const existing = byConid.get(r.conid);
    if (!existing || r.exchange === "SMART") byConid.set(r.conid, r);
  }
  const out: SecdefInfoRow[] = [];
  for (const r of byConid.values()) {
    out.push({
      conid: r.conid,
      underlyingConid: undConid,
      month,
      strike: r.strike,
      right: r.right,
      maturityDate: r.maturityDate,
      multiplier: r.multiplier,
    });
  }
  return out;
}

interface Bucket {
  undConid: number;
  month: string;
  strike: number;
  right: "C" | "P";
}

// Resolve real expiries for OPT positions whose third-Friday fallback was
// applied in adaptPosition. Stocks and any option already cached in the
// secdef store pass through with no IBKR call. Failed lookups keep the
// fallback expiry rather than dropping the position — same UX as today,
// just no worse.
export async function enrichOptionExpiries(positions: Position[]): Promise<Position[]> {
  const buckets = new Map<string, Bucket>();
  for (const p of positions) {
    if (p.assetClass !== "OPT") continue;
    if (!p.conid || !p.underlyingConid) continue;
    if (getInfoByConid(p.conid)) continue;
    const desc = parseDesc(p.contractDesc);
    if (!desc) continue;
    const month = monthCode(desc.monthThree, desc.year);
    const key = `${p.underlyingConid}:${month}:${desc.strike}:${desc.right}`;
    if (!buckets.has(key)) {
      buckets.set(key, { undConid: p.underlyingConid, month, strike: desc.strike, right: desc.right });
    }
  }

  if (buckets.size > 0) {
    await ensureIserverBridge();
    for (const b of buckets.values()) {
      const rows = await fetchInfoForBucket(b.undConid, b.month, b.strike, b.right).catch(() => [] as SecdefInfoRow[]);
      if (rows.length > 0) insertInfoRows(rows);
    }
  }

  return positions.map((p) => {
    if (p.assetClass !== "OPT") return p;
    if (!p.conid) return p;
    const row = getInfoByConid(p.conid);
    if (!row) return p;
    return { ...p, expiry: maturityToIso(row.maturityDate) };
  });
}
