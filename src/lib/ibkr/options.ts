// IBKR Client Portal Web API — narrow option chain fetcher.
//
// Returns a focused chain (configurable DTE window + ±strikePctWindow of spot)
// with real Greeks from IBKR's marketdata snapshot.
//
// Flow:
//   1. secdef/search   → underlying conid + available month codes (JUN26 etc.)
//   2. filter months by approx DTE window
//   3. secdef/strikes  → strike list per month, filter by ±strikePctWindow of spot
//   4. secdef/info     → one call per (strike, right) returns ALL weekly expiries
//                        within that month. We collect all conids + actual maturities.
//   5. filter by exact DTE window now that we know the maturity dates
//   6. marketdata/snapshot (×2) → batch quotes + Greeks. First call seeds the
//                                  stream, second call returns full data.

import { ensureIserverBridge, ibkr } from "./client";
import {
  getKnownInfoRows,
  getStrikes as storeGetStrikes,
  getUnderlying as storeGetUnderlying,
  insertInfoRows,
  putStrikes as storePutStrikes,
  putUnderlying as storePutUnderlying,
  type SecdefInfoRow,
} from "./secdef-store";
import type { OptionChain, OptionContract, OptionExpiry, Position } from "../types";

const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

interface SecdefSection {
  secType: string;
  months?: string;
  exchange?: string;
}

interface SecdefSearchHit {
  conid: string | number;
  symbol: string;
  description?: string;
  sections?: SecdefSection[];
}

// In-flight dedup so concurrent in-process callers share one IBKR call per
// key. The persistent store (secdef-store.ts) is the cache; these maps only
// guard the brief window between "decided to fetch" and "INSERT committed."
const CONID_INFLIGHT = new Map<string, Promise<{ conid: number; months: string[] }>>();
const STRIKES_INFLIGHT = new Map<string, Promise<StrikesResponse>>();
const INFO_INFLIGHT = new Map<string, Promise<SecdefInfoRow[]>>();

// ---------- concurrency limiter for /iserver/secdef/* ----------
// IBKR's per-second throttle on the secdef/* family is the bottleneck on a
// cold-cache search (we fan out ~30 secdef/info calls). A small semaphore
// caps simultaneous in-flight calls so the burst spreads over a few seconds
// rather than triggering 429s. Cache hits bypass the limiter — only actual
// HTTP calls are gated.

class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (this.active < this.max) {
          this.active++;
          resolve(() => this.release());
        } else {
          this.waiters.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const SECDEF_LIMITER = new Semaphore(3);

async function withSecdefLimit<T>(fn: () => Promise<T>): Promise<T> {
  const release = await SECDEF_LIMITER.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function searchUnderlying(symbol: string): Promise<{ conid: number; months: string[] }> {
  const cached = storeGetUnderlying(symbol);
  // Empty months means a prior search resolved to an instrument with no
  // option chain (typically an IND or CFD that shared the ticker — see
  // selection logic below). Re-resolve rather than serving the bad entry
  // forever; one extra secdef/search call is cheap.
  if (cached && cached.months.length > 0) return cached;
  const inflight = CONID_INFLIGHT.get(symbol);
  if (inflight) return inflight;
  const promise = withSecdefLimit(async () => {
    const params = new URLSearchParams({ symbol, secType: "STK" });
    const rows = await ibkr<SecdefSearchHit[]>(`/iserver/secdef/search?${params}`);
    if (!rows?.length) throw new Error(`secdef/search: no result for ${symbol}`);
    // Multiple instruments can share a ticker. "MA" returns both Mastercard
    // (NYSE) and a FORECASTX index "US Mortgage Applications"; the FORECASTX
    // hit sorts first but only has an IND section and no OPT chain. Taking
    // rows[0] blindly silently breaks the chain for those tickers. Prefer
    // the first hit with both STK and OPT (non-empty months); fall back to
    // the first STK hit; finally rows[0] as a last resort.
    let chosenHit: SecdefSearchHit | null = null;
    let chosenMonths: string[] = [];
    for (const r of rows) {
      const hasStk = r.sections?.some((s) => s.secType === "STK");
      const optMonths = r.sections?.find((s) => s.secType === "OPT")?.months;
      const months = optMonths ? optMonths.split(";").filter(Boolean) : [];
      if (hasStk && months.length > 0) {
        chosenHit = r;
        chosenMonths = months;
        break;
      }
    }
    if (!chosenHit) {
      chosenHit = rows.find((r) => r.sections?.some((s) => s.secType === "STK")) ?? rows[0];
      const optMonths = chosenHit.sections?.find((s) => s.secType === "OPT")?.months;
      chosenMonths = optMonths ? optMonths.split(";").filter(Boolean) : [];
    }
    const result = { conid: Number(chosenHit.conid), months: chosenMonths };
    if (result.months.length > 0) {
      storePutUnderlying(symbol, result.conid, result.months);
    }
    return result;
  }).finally(() => CONID_INFLIGHT.delete(symbol));
  CONID_INFLIGHT.set(symbol, promise);
  return promise;
}

interface StrikesResponse {
  call?: number[];
  put?: number[];
}

async function getStrikes(undConid: number, month: string, exchange: string): Promise<StrikesResponse> {
  const cached = storeGetStrikes(undConid, month, exchange);
  if (cached) return { call: cached.call, put: cached.put };
  const key = `${undConid}:${month}:${exchange}`;
  const inflight = STRIKES_INFLIGHT.get(key);
  if (inflight) return inflight;
  const promise = withSecdefLimit(async () => {
    const params = new URLSearchParams({
      conid: String(undConid),
      sectype: "OPT",
      month,
      exchange,
    });
    const result = await ibkr<StrikesResponse>(`/iserver/secdef/strikes?${params}`);
    storePutStrikes(undConid, month, exchange, result.call ?? [], result.put ?? []);
    return result;
  }).finally(() => STRIKES_INFLIGHT.delete(key));
  STRIKES_INFLIGHT.set(key, promise);
  return promise;
}

// Wire-only fetch: one IBKR /iserver/secdef/info call. A single (month, strike,
// right) bucket can map to multiple conids — the monthly plus several weeklies
// that share the same calendar month. The wire also returns one row per
// exchange listing per conid (SMART/AMEX/CBOE/…). Dedup by conid keeping the
// SMART row, then return every distinct conid. Returning only one used to
// silently strip weekly conids and leave held positions uncached
// (see enrich.ts's getInfoByConid hit-or-miss path).
async function fetchBucketInfo(
  undConid: number,
  month: string,
  strike: number,
  right: "C" | "P",
): Promise<SecdefInfoRow[]> {
  const key = `${undConid}:${month}:${strike}:${right}`;
  const inflight = INFO_INFLIGHT.get(key);
  if (inflight) return inflight;
  const promise = withSecdefLimit(async () => {
    const params = new URLSearchParams({
      conid: String(undConid),
      sectype: "OPT",
      month,
      strike: String(strike),
      right,
    });
    const rows = await ibkr<Array<SecdefInfoRow & { exchange?: string }>>(
      `/iserver/secdef/info?${params}`,
    );
    if (!rows?.length) return [];
    const byConid = new Map<number, SecdefInfoRow & { exchange?: string }>();
    for (const r of rows) {
      if (typeof r.conid !== "number") continue;
      const existing = byConid.get(r.conid);
      if (!existing || r.exchange === "SMART") byConid.set(r.conid, r);
    }
    return [...byConid.values()].map((r) => ({
      conid: r.conid,
      underlyingConid: undConid,
      month,
      strike: r.strike,
      right: r.right,
      maturityDate: r.maturityDate,
      multiplier: r.multiplier,
    } as SecdefInfoRow));
  }).finally(() => INFO_INFLIGHT.delete(key));
  INFO_INFLIGHT.set(key, promise);
  return promise;
}

// Snapshot field IDs (Client Portal Web API).
const FIELD_LAST = "31";
const FIELD_BID = "84";
const FIELD_ASK = "86";
const FIELD_VOLUME = "87";
// IV: 7633 is the populated field on Client Portal (returns e.g. "29.6%").
// 7283 is also documented as "Option Implied Vol %" but comes back empty in
// practice — keep it as a secondary source, prefer 7633.
const FIELD_IV_PRIMARY = "7633";
const FIELD_IV_SECONDARY = "7283";
const FIELD_DELTA = "7308";
const FIELD_GAMMA = "7309";
const FIELD_THETA = "7310";
const FIELD_VEGA = "7311";
const FIELD_OI = "7607";

const SNAPSHOT_FIELDS = [
  FIELD_LAST, FIELD_BID, FIELD_ASK, FIELD_VOLUME,
  FIELD_IV_PRIMARY, FIELD_IV_SECONDARY,
  FIELD_DELTA, FIELD_GAMMA, FIELD_THETA, FIELD_VEGA, FIELD_OI,
].join(",");

type SnapshotRow = { conid: number } & Record<string, string | number | undefined>;

// Snapshot retry + chunking strategy:
//   IBKR's snapshot API is async — fields stream in over multiple seconds.
//   Empirically the endpoint also can't sustain large per-call subscriptions:
//   batches of ~4 conids fully populate by poll 3, ~84 take all 5 polls, and
//   180+ silently never deliver prices at all (typical narrow chain is
//   3 expiries × ~30 strikes × 2 sides = ~180 conids — exactly the cliff).
//   Beyond batch size, in-flight concurrency matters too: sending 6 chunks
//   in parallel in one test saturated the gateway's subscription buffer and
//   the first chunks (DTE 21) returned 0/60 prices while later chunks
//   succeeded. We cap concurrency to keep the gateway responsive.
//
//   Within a chunk: 5 polls, field-level merge, early-exit once every conid
//   has IV + delta AND at least one price field (bid/ask/last). Early-exiting
//   on Greeks alone leaves price-less rows downstream which surfaces as
//   quotesAvailable=false even during RTH; including a price field is the
//   condition that actually matters for the picker.
const MAX_TRIES = 5;
const POLL_DELAY_MS = 700;
const SNAPSHOT_CHUNK = 40;
const SNAPSHOT_CONCURRENCY = 2;

async function snapshotChunk(conids: number[]): Promise<Map<number, SnapshotRow>> {
  if (!conids.length) return new Map();
  const params = new URLSearchParams({ conids: conids.join(","), fields: SNAPSHOT_FIELDS });
  const merged = new Map<number, SnapshotRow>();
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
    const rows = await ibkr<SnapshotRow[]>(`/iserver/marketdata/snapshot?${params}`).catch((e) => {
      // Don't swallow "no bridge" — that's the gateway dropping its iserver
      // session, and silently returning [] would produce an empty chain that
      // downstream renders as "Live quotes unavailable" without ever hinting
      // at the real cause. Propagate so the route returns a clear error and
      // VerdictCard's friendlyPickHint("no bridge") tells the user to wake
      // the gateway. Other transients (e.g. a single dropped poll) still
      // soft-fall to [] so other polls/chunks contribute.
      const msg = (e as Error).message ?? "";
      if (msg.toLowerCase().includes("no bridge")) throw e;
      return [] as SnapshotRow[];
    });
    for (const r of rows) {
      if (typeof r.conid !== "number") continue;
      const prior = merged.get(r.conid) ?? ({ conid: r.conid } as SnapshotRow);
      // Field-level merge: a later call may add IV without overwriting Greeks
      // that already arrived in an earlier call.
      for (const [k, v] of Object.entries(r)) {
        if (v !== undefined && v !== null && v !== "") prior[k] = v;
      }
      merged.set(r.conid, prior);
    }
    if (
      attempt > 0 &&
      conids.every((c) => {
        const row = merged.get(c);
        if (!row) return false;
        const hasGreeks = row[FIELD_IV_PRIMARY] !== undefined && row[FIELD_DELTA] !== undefined;
        const hasPrice =
          row[FIELD_BID] !== undefined ||
          row[FIELD_ASK] !== undefined ||
          row[FIELD_LAST] !== undefined;
        return hasGreeks && hasPrice;
      })
    ) break;
  }
  return merged;
}

async function snapshot(conids: number[]): Promise<Map<number, SnapshotRow>> {
  if (!conids.length) return new Map();
  const chunks: number[][] = [];
  for (let i = 0; i < conids.length; i += SNAPSHOT_CHUNK) {
    chunks.push(conids.slice(i, i + SNAPSHOT_CHUNK));
  }
  // Bounded concurrency. Fully-parallel saturates the gateway's snapshot
  // subscription buffer (observed: 6 concurrent chunks → first chunks
  // returned 0/60 prices, later chunks 21/60). Strict-serial is safe but
  // slow (~3.5s × chunks); a concurrency of 2 typically clears a 180-conid
  // chain in ~3 waves.
  const partials = await runWithConcurrency(chunks, SNAPSHOT_CONCURRENCY, snapshotChunk);
  const merged = new Map<number, SnapshotRow>();
  for (const p of partials) for (const [k, v] of p) merged.set(k, v);
  return merged;
}

// Snapshot prices come back as strings sometimes prefixed with a marker letter:
//   "C23.27"  closed-market last
//   "H184.50" halted
//   "32.5"    raw number
// We strip any leading non-numeric run. Returns null for blanks / NaN.
function parseSnapshotNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/^[^0-9.\-]+/, "").replace(/%$/, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Build an OCC-style contract code: AAPL250620C00150000.
// Used for downstream identifiers — the picker echoes this back as `code`,
// the UI shows it in the contract-pick card.
function occCode(ticker: string, maturityDate: string, right: "C" | "P", strike: number): string {
  const yy = maturityDate.slice(2, 4);
  const mm = maturityDate.slice(4, 6);
  const dd = maturityDate.slice(6, 8);
  const strikeMills = Math.round(strike * 1000).toString().padStart(8, "0");
  return `${ticker}${yy}${mm}${dd}${right}${strikeMills}`;
}

function maturityToISO(maturityDate: string): string {
  return `${maturityDate.slice(0, 4)}-${maturityDate.slice(4, 6)}-${maturityDate.slice(6, 8)}`;
}

function todayUTC(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Approximate DTE for an IBKR month code ("JUN26" → midmonth date).
// Used for coarse pre-filter before we know the exact maturityDate.
function monthDte(code: string, todayMs: number): number {
  const mon = MONTH_CODES.indexOf(code.slice(0, 3));
  const yy = Number("20" + code.slice(3, 5));
  if (mon < 0 || !Number.isFinite(yy)) return -1;
  const mid = Date.UTC(yy, mon, 15);
  return Math.round((mid - todayMs) / 86_400_000);
}

async function runWithConcurrency<I, O>(
  items: I[],
  n: number,
  fn: (item: I, idx: number) => Promise<O>,
): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, Math.max(1, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface NarrowChainOptions {
  expiryMinDays?: number;
  expiryMaxDays?: number;
  maxExpiries?: number;
  strikePctWindow?: number;
  /** % below spot to include (e.g. 0.25 = 25% below). Overrides strikePctWindow for lower bound. */
  lowerPctWindow?: number;
  /** % above spot to include (e.g. 0.08 = 8% above). Overrides strikePctWindow for upper bound. */
  upperPctWindow?: number;
  exchange?: string;
}

export async function getNarrowOptionChain(
  symbol: string,
  spot: number,
  options: NarrowChainOptions = {},
): Promise<OptionChain> {
  const {
    expiryMinDays = 20,
    expiryMaxDays = 60,
    maxExpiries = 3,
    strikePctWindow = 0.15,
    exchange = "SMART",
  } = options;
  const lowerWindow = options.lowerPctWindow ?? strikePctWindow;
  const upperWindow = options.upperPctWindow ?? strikePctWindow;

  if (!spot || spot <= 0) throw new Error(`getNarrowOptionChain: invalid spot ${spot} for ${symbol}`);

  // moomoo-style "US.AAPL" → "AAPL". For non-US prefixes (HK., SG., …) the
  // underlying ticker is still the part after the dot; iserver handles routing
  // via the exchange query in resolveOption.
  const ticker = symbol.includes(".") ? symbol.slice(symbol.indexOf(".") + 1) : symbol;

  await ensureIserverBridge();

  const { conid: undConid, months: availableMonths } = await searchUnderlying(ticker);

  const today = todayUTC();
  // Coarse pre-filter: keep months whose midpoint is within DTE window + a
  // 21-day buffer (a "month" code spans the whole month, so we don't want to
  // drop one whose weeklies happen to land in our window even if the midpoint
  // doesn't).
  const monthsInWindow = availableMonths
    .map((m) => ({ m, dte: monthDte(m, today) }))
    .filter((x) => x.dte >= 0 && x.dte <= expiryMaxDays + 21)
    .sort((a, b) => a.dte - b.dte)
    .slice(0, maxExpiries + 1);

  if (!monthsInWindow.length) return { symbol, spot, expiries: [] };

  const minStrike = spot * (1 - lowerWindow);
  const maxStrike = spot * (1 + upperWindow);

  // Phase 1: fetch strikes per month (DB hit or one /secdef/strikes call).
  const strikesPerMonth = new Map<string, { call: number[]; put: number[] }>();
  for (const { m } of monthsInWindow) {
    const sk = await getStrikes(undConid, m, exchange).catch(() => null);
    if (!sk) continue;
    strikesPerMonth.set(m, { call: sk.call ?? [], put: sk.put ?? [] });
  }

  // Phase 2: one bulk SELECT for everything we already have across all wanted
  // months. Anything not in this result set becomes a gap to fan out to IBKR.
  const wantedMonths = [...strikesPerMonth.keys()];
  const knownInfoRows = wantedMonths.length > 0 ? getKnownInfoRows(undConid, wantedMonths) : [];
  const haveKey = (mo: string, s: number, r: "C" | "P") => `${mo}:${s}:${r}`;
  const haveSet = new Set<string>(knownInfoRows.map((row) => haveKey(row.month, row.strike, row.right)));

  // Phase 3: build the gap set, filtered by the strike window.
  const gap: Array<{ month: string; strike: number; right: "C" | "P" }> = [];
  for (const [m, sk] of strikesPerMonth) {
    for (const s of sk.call) {
      if (s >= minStrike && s <= maxStrike && !haveSet.has(haveKey(m, s, "C"))) {
        gap.push({ month: m, strike: s, right: "C" });
      }
    }
    for (const s of sk.put) {
      if (s >= minStrike && s <= maxStrike && !haveSet.has(haveKey(m, s, "P"))) {
        gap.push({ month: m, strike: s, right: "P" });
      }
    }
  }

  // Phase 4: fan out only the gap; existing concurrency limit + 429 retry.
  // Each bucket fetch can return multiple conids (weeklies sharing a month),
  // so flatten before inserting.
  let bucketErrCount = 0;
  let bucketEmptyCount = 0;
  const fetched = await runWithConcurrency(gap, 8, ({ month, strike, right }) =>
    fetchBucketInfo(undConid, month, strike, right).then(
      (rows) => {
        if (!rows.length) bucketEmptyCount++;
        return rows;
      },
      (e) => {
        bucketErrCount++;
        console.warn(`[chain] bucket fail ${ticker} ${month} ${strike}${right}:`, (e as Error)?.message ?? e);
        return [] as SecdefInfoRow[];
      },
    ),
  );
  const fetchedRows: SecdefInfoRow[] = fetched.flat();
  if (bucketErrCount || bucketEmptyCount) {
    console.warn(`[chain] ${ticker} undConid=${undConid} gaps=${gap.length} errs=${bucketErrCount} empties=${bucketEmptyCount} fetchedRows=${fetchedRows.length}`);
  }
  insertInfoRows(fetchedRows);

  // Phase 5: merge known + fetched, then filter to the strike window so the
  // downstream maturity / DTE filter only sees relevant rows. (DB rows may
  // include strikes from a prior wider-window analysis.)
  const resolvedRows: SecdefInfoRow[] = [];
  for (const row of [...knownInfoRows, ...fetchedRows]) {
    if (row.strike < minStrike || row.strike > maxStrike) continue;
    resolvedRows.push(row);
  }

  // Now filter by exact DTE and group by expiry.
  const byExpiry = new Map<string, { dte: number; rows: SecdefInfoRow[] }>();
  for (const row of resolvedRows) {
    if (!row.maturityDate || row.maturityDate.length !== 8) continue;
    const expISO = maturityToISO(row.maturityDate);
    const expMs = Date.UTC(
      Number(row.maturityDate.slice(0, 4)),
      Number(row.maturityDate.slice(4, 6)) - 1,
      Number(row.maturityDate.slice(6, 8)),
    );
    const dte = Math.round((expMs - today) / 86_400_000);
    if (dte < expiryMinDays || dte > expiryMaxDays) continue;
    const bucket = byExpiry.get(expISO) ?? { dte, rows: [] };
    bucket.rows.push(row);
    byExpiry.set(expISO, bucket);
  }

  const sortedExpiries = [...byExpiry.entries()]
    .sort((a, b) => a[1].dte - b[1].dte)
    .slice(0, maxExpiries);

  // Single batched snapshot for everything we plan to return.
  const allConids = sortedExpiries.flatMap(([, v]) => v.rows.map((r) => r.conid));
  const snaps = await snapshot(allConids);

  const expiries: OptionExpiry[] = sortedExpiries.map(([expiry, { dte, rows }]) => {
    const contracts: OptionContract[] = rows
      .map((row): OptionContract => {
        const s = snaps.get(row.conid) ?? ({} as SnapshotRow);
        return {
          code: occCode(ticker, row.maturityDate, row.right, row.strike),
          conid: row.conid,
          side: row.right,
          strike: row.strike,
          last: parseSnapshotNumber(s[FIELD_LAST]),
          bid: parseSnapshotNumber(s[FIELD_BID]),
          ask: parseSnapshotNumber(s[FIELD_ASK]),
          iv: parseSnapshotNumber(s[FIELD_IV_PRIMARY]) ?? parseSnapshotNumber(s[FIELD_IV_SECONDARY]),
          delta: parseSnapshotNumber(s[FIELD_DELTA]),
          gamma: parseSnapshotNumber(s[FIELD_GAMMA]),
          theta: parseSnapshotNumber(s[FIELD_THETA]),
          vega: parseSnapshotNumber(s[FIELD_VEGA]),
          oi: parseSnapshotNumber(s[FIELD_OI]),
          volume: parseSnapshotNumber(s[FIELD_VOLUME]),
        };
      })
      .sort((a, b) => a.strike - b.strike || a.side.localeCompare(b.side));
    return { expiry, dte, contracts };
  });

  return { symbol, spot, expiries };
}

// Enrich held option positions with their live Greeks (delta/theta/vega/iv).
// Stock positions and any non-OPT rows pass through unchanged. We piggy-back on
// the same /iserver/marketdata/snapshot polling logic the chain fetcher uses,
// so a position that exists in the user's IBKR account already has a known
// conid we can query directly. Failures degrade silently — the verdict still
// runs, just without the live-Greeks defensive checks.
export async function enrichWithLiveGreeks(positions: Position[]): Promise<Position[]> {
  const optConids = positions
    .filter((p) => p.assetClass === "OPT")
    .map((p) => p.conid);
  if (!optConids.length) return positions;

  await ensureIserverBridge();
  const snaps = await snapshot(optConids);

  return positions.map((p) => {
    if (p.assetClass !== "OPT") return p;
    const s = snaps.get(p.conid);
    if (!s) return p;
    return {
      ...p,
      liveGreeks: {
        delta: parseSnapshotNumber(s[FIELD_DELTA]),
        theta: parseSnapshotNumber(s[FIELD_THETA]),
        vega: parseSnapshotNumber(s[FIELD_VEGA]),
        iv: parseSnapshotNumber(s[FIELD_IV_PRIMARY]) ?? parseSnapshotNumber(s[FIELD_IV_SECONDARY]),
      },
    };
  });
}
