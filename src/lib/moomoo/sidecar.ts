import { env } from "../env";
import type {
  AnomalyKind,
  AnomalyResult,
  FundamentalsData,
  FundamentalsResult,
  PeersResult,
  SnapshotResult,
  VolSummary,
} from "../types";

interface RawAnomalyResponse {
  method: string;
  symbol: string;
  time_range: number;
  language_id: number;
  dimensions: string[];
  data: {
    err_code?: number;
    retMsg?: string;
    time_range?: string;
    content?: string;
    [k: string]: unknown;
  };
}

interface RawSnapshotResponse {
  symbol: string;
  data: {
    code: string;
    name: string;
    last_price: number;
    prev_close_price: number;
    update_time: string;
    volume: number;
    [k: string]: unknown;
  };
}

async function callSidecar<T>(path: string, params: Record<string, string>): Promise<T> {
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

const PATHS: Record<AnomalyKind, string> = {
  capital: "/anomaly/capital",
  technical: "/anomaly/technical",
  derivatives: "/anomaly/derivatives",
};

export async function getAnomaly(
  kind: AnomalyKind,
  symbol: string,
  timeRange = 30
): Promise<AnomalyResult> {
  const r = await callSidecar<RawAnomalyResponse>(PATHS[kind], {
    symbol,
    time_range: String(timeRange),
    language_id: "2",
  });
  return {
    kind,
    symbol,
    timeRange,
    content: typeof r.data?.content === "string" ? r.data.content : "",
    raw: r.data,
  };
}

interface RawFundamentalsResponse {
  symbol: string;
  yfTicker: string;
  data: FundamentalsData;
}

export async function getFundamentals(symbol: string): Promise<FundamentalsResult> {
  const r = await callSidecar<RawFundamentalsResponse>("/fundamentals", { symbol });
  return { symbol: r.symbol, yfTicker: r.yfTicker, data: r.data };
}

interface RawVolSummaryResponse {
  symbol: string;
  yfTicker: string;
  spot: number;
  expiry_used: string;
  dte: number;
  atm_iv: number | null;
  atm_iv_call: number | null;
  atm_iv_put: number | null;
  atm_strike_call: number | null;
  atm_strike_put: number | null;
  hv_30: number | null;
  hv_60: number | null;
  iv_hv_ratio: number | null;
  skew_25d: number | null;
  skew_25d_call_strike: number | null;
  skew_25d_put_strike: number | null;
  hv_sample_size: number;
}

// Structured ATM IV + HV30 + 25Δ skew for a single ticker. The derivatives
// panel feeds these in alongside the anomaly text so the model cites hard
// numbers rather than inferring them from prose. Returns null when the
// sidecar fails — derivatives panel still runs on the anomaly text alone.
export async function getVolSummary(
  symbol: string,
  targetDte = 30,
): Promise<VolSummary | null> {
  try {
    const r = await callSidecar<RawVolSummaryResponse>("/options/vol-summary", {
      symbol,
      target_dte: String(targetDte),
    });
    return {
      symbol: r.symbol,
      spot: r.spot,
      expiryUsed: r.expiry_used,
      dte: r.dte,
      atmIv: r.atm_iv,
      atmIvCall: r.atm_iv_call,
      atmIvPut: r.atm_iv_put,
      atmStrikeCall: r.atm_strike_call,
      atmStrikePut: r.atm_strike_put,
      hv30: r.hv_30,
      hv60: r.hv_60,
      ivHvRatio: r.iv_hv_ratio,
      skew25d: r.skew_25d,
      skew25dCallStrike: r.skew_25d_call_strike,
      skew25dPutStrike: r.skew_25d_put_strike,
      hvSampleSize: r.hv_sample_size,
    };
  } catch {
    return null;
  }
}

export async function getSnapshot(symbol: string): Promise<SnapshotResult> {
  const r = await callSidecar<RawSnapshotResponse>("/snapshot", { symbol });
  const d = r.data;
  const last = Number(d.last_price);
  const prev = Number(d.prev_close_price);
  return {
    symbol: d.code,
    name: d.name,
    lastPrice: last,
    prevClose: prev,
    changePct: prev ? ((last - prev) / prev) * 100 : 0,
    volume: Number(d.volume),
    updateTime: d.update_time,
    raw: d,
  };
}

// Large-cap sector peers (OpenD plates, $10B+ / >= $20 filter applied server-side).
// Returns an empty peer list rather than throwing on any failure (no INDUSTRY
// plate, OpenD down, etc.) so the News panel still renders its self-news block.
export async function getPeers(symbol: string, top = 8): Promise<PeersResult> {
  try {
    const r = await callSidecar<PeersResult>(`/peers/${encodeURIComponent(symbol)}`, {
      top: String(top),
    });
    return {
      symbol: r.symbol ?? symbol,
      industryPlate: r.industryPlate ?? null,
      peers: Array.isArray(r.peers) ? r.peers : [],
    };
  } catch {
    return { symbol, industryPlate: null, peers: [] };
  }
}

