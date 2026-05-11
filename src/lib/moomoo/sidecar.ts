import { env } from "../env";
import type {
  AnomalyKind,
  AnomalyResult,
  FundamentalsData,
  FundamentalsResult,
  SnapshotResult,
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

