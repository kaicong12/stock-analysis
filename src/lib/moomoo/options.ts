// moomoo options client — replaces the IBKR fan-out in src/lib/ibkr/options.ts.
//   - enrichWithLiveGreeks → held-position greeks for the verdict's defensive-roll logic
//
// Why moomoo replaced IBKR for options:
//   - Greeks are computed by moomoo and arrive in the snapshot row directly.
//   - No SQLite cache, no 429 retry, no semaphore, no field-merge polling loop.

import { env } from "../env";
import type { Position } from "../types";

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
