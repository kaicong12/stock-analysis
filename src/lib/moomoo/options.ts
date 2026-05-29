// moomoo options client — replaces the IBKR fan-out in src/lib/ibkr/options.ts.
// Two callers:
//   - getNarrowOptionChain → contract picker (DTE-windowed, strike-windowed chain w/ greeks)
//   - enrichWithLiveGreeks → held-position greeks for the verdict's defensive-roll logic
//
// Why moomoo replaced IBKR for options:
//   - One sidecar call returns the full strike ladder + bid/ask/IV/greeks/OI per contract.
//     IBKR needed secdef/search → secdef/strikes → ~30 secdef/info calls → marketdata/snapshot
//     polled 5× with chunking + bounded concurrency to dodge a 180-conid cliff.
//   - Greeks are computed by moomoo and arrive in the snapshot row directly.
//   - No SQLite cache, no 429 retry, no semaphore, no field-merge polling loop.

import { env } from "../env";
import type { OptionChain, OptionContract, OptionExpiry, Position } from "../types";

interface RawContract {
  code: string;
  name: string | null;
  strike: number;
  side: "C" | "P";
  expiry: string;            // ISO YYYY-MM-DD
  lot_size: number | null;
  expiration_cycle: string | null;
  last_price: number | null;
  bid_price: number | null;
  ask_price: number | null;
  volume: number | null;
  open_interest: number | null;
  implied_volatility: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  rho: number | null;
  update_time: string | null;
}

interface RawChainResponse {
  symbol: string;
  start: string;
  end: string;
  contracts: RawContract[];
}

interface RawExpiry {
  strike_time: string;            // YYYY-MM-DD
  option_expiry_date_distance: number;
  expiration_cycle: string;
}

interface RawExpiriesResponse {
  symbol: string;
  data: RawExpiry[];
}

interface RawSnapshotResponse {
  codes: string[];
  data: Array<Record<string, unknown> & { code?: string }>;
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${env.pyBackendUrl}${path}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sidecar ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// moomoo symbols are `MARKET.TICKER` (e.g. "US.AAPL"). The IBKR options module
// historically accepted bare tickers too; preserve that for callers that haven't
// migrated yet — default to US.
function normalizeSymbol(symbol: string): string {
  return symbol.includes(".") ? symbol : `US.${symbol.toUpperCase()}`;
}

function ivPct(iv: number | null): number | null {
  // Sidecar passes through moomoo's value as-is, which is a percent (e.g. 28.5).
  // Downstream consumers (contract picker, UI) expect a percent — match what
  // the IBKR module produced (FIELD_IV_PRIMARY 7633 was "29.6%"-style).
  return iv;
}

function todayUTC(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dteFromExpiry(expiryIso: string, today: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiryIso);
  if (!m) return -1;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((ms - today) / 86_400_000);
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
  } = options;
  const lowerWindow = options.lowerPctWindow ?? strikePctWindow;
  const upperWindow = options.upperPctWindow ?? strikePctWindow;

  if (!spot || spot <= 0) throw new Error(`getNarrowOptionChain: invalid spot ${spot} for ${symbol}`);

  const mooSymbol = normalizeSymbol(symbol);
  const today = todayUTC();

  // Phase 1: pick expiries in the DTE window.
  const expRes = await getJson<RawExpiriesResponse>("/options/expiries", { symbol: mooSymbol });
  const candidates = (expRes.data ?? [])
    .map((e) => ({ expiry: e.strike_time, dte: e.option_expiry_date_distance }))
    .filter((e) => e.dte >= expiryMinDays && e.dte <= expiryMaxDays)
    .sort((a, b) => a.dte - b.dte)
    .slice(0, maxExpiries);

  if (!candidates.length) {
    return { symbol: mooSymbol, spot, expiries: [] };
  }

  // Phase 2: one chain+snapshot call covering the whole DTE range.
  const start = candidates[0].expiry;
  const end = candidates[candidates.length - 1].expiry;
  const minStrike = spot * (1 - lowerWindow);
  const maxStrike = spot * (1 + upperWindow);

  const chainRes = await getJson<RawChainResponse>("/options/chain", {
    symbol: mooSymbol,
    start,
    end,
    min_strike: String(minStrike),
    max_strike: String(maxStrike),
    include_snapshot: "true",
  });

  // Group contracts by their actual expiry, filtering to expiries we selected
  // (moomoo can return contracts on dates in-between with different cycles).
  const wantedExpiries = new Set(candidates.map((c) => c.expiry));
  const byExpiry = new Map<string, OptionContract[]>();
  for (const c of chainRes.contracts ?? []) {
    if (!wantedExpiries.has(c.expiry)) continue;
    const contract: OptionContract = {
      code: c.code,
      side: c.side,
      strike: c.strike,
      last: c.last_price,
      bid: c.bid_price,
      ask: c.ask_price,
      iv: ivPct(c.implied_volatility),
      delta: c.delta,
      gamma: c.gamma,
      theta: c.theta,
      vega: c.vega,
      oi: c.open_interest,
      volume: c.volume,
    };
    const bucket = byExpiry.get(c.expiry) ?? [];
    bucket.push(contract);
    byExpiry.set(c.expiry, bucket);
  }

  const expiries: OptionExpiry[] = candidates
    .map(({ expiry, dte }) => {
      const contracts = byExpiry.get(expiry) ?? [];
      contracts.sort((a, b) => a.strike - b.strike || a.side.localeCompare(b.side));
      return { expiry, dte: dte ?? dteFromExpiry(expiry, today), contracts };
    })
    .filter((e) => e.contracts.length > 0);

  return { symbol: mooSymbol, spot, expiries };
}

// Build a moomoo option code from a held IBKR position. moomoo format:
//   US.{TICKER}{YYMMDD}{C|P}{STRIKE_MILLS}
// where STRIKE_MILLS is strike × 1000 with leading zeros stripped.
// e.g. AAPL 2026-06-19 P 260 → US.AAPL260619P260000
function moomooCodeFromPosition(p: Position): string | null {
  if (p.assetClass !== "OPT") return null;
  if (!p.expiry || !p.strike || !p.putOrCall) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.expiry);
  if (!m) return null;
  const yymmdd = `${m[1].slice(2)}${m[2]}${m[3]}`;
  const side = p.putOrCall === "C" || p.putOrCall === "P" ? p.putOrCall : null;
  if (!side) return null;
  // contractDesc is "AAPL JUN2026 260 P" — first token is the ticker.
  const ticker = p.contractDesc.trim().split(/\s+/)[0]?.toUpperCase();
  if (!ticker) return null;
  const mills = Math.round(p.strike * 1000);
  return `US.${ticker}${yymmdd}${side}${mills}`;
}

// Enrich held OPT positions with live greeks for the verdict's defensive-roll logic.
// Stock positions pass through unchanged. Snapshot failures degrade silently
// (verdict still runs, just without live greeks defensive checks) — matches the
// behavior of the IBKR module this replaces.
export async function enrichWithLiveGreeks(positions: Position[]): Promise<Position[]> {
  const opt = positions.filter((p) => p.assetClass === "OPT");
  if (!opt.length) return positions;

  const codeByConid = new Map<number, string>();
  for (const p of opt) {
    const code = moomooCodeFromPosition(p);
    if (code) codeByConid.set(p.conid, code);
  }
  if (!codeByConid.size) return positions;

  const codes = [...codeByConid.values()];
  let snapByCode = new Map<string, Record<string, unknown>>();
  try {
    const res = await getJson<RawSnapshotResponse>("/options/snapshot", { codes: codes.join(",") });
    for (const row of res.data ?? []) {
      if (typeof row.code === "string") snapByCode.set(row.code, row);
    }
  } catch (err) {
    // Same failure mode as before: log and pass through. The verdict still
    // runs without live greeks; defensive-roll just won't fire.
    console.warn(`[moomoo] options snapshot failed:`, (err as Error).message);
    snapByCode = new Map();
  }

  function num(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  }

  return positions.map((p) => {
    if (p.assetClass !== "OPT") return p;
    const code = codeByConid.get(p.conid);
    if (!code) return p;
    const row = snapByCode.get(code);
    if (!row) return p;
    return {
      ...p,
      liveGreeks: {
        delta: num(row.option_delta),
        theta: num(row.option_theta),
        vega: num(row.option_vega),
        iv: num(row.option_implied_volatility),
      },
    };
  });
}
