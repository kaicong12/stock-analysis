import { env } from "../env";
import type {
  AnomalyKind,
  AnomalyResult,
  FundamentalsData,
  FundamentalsResult,
  MorningstarReport,
  PeersResult,
  PriceAction,
  ScreenerFunnel,
  ScreenerResult,
  SnapshotResult,
  TechnicalIndicators,
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

// Deterministic price-action breakdown/breakout signal (yfinance daily OHLCV).
// Feeds the verdict's falling-knife guard. Returns null on any sidecar failure —
// the guard then no-ops (a missing signal must never block a normal verdict).
// The backend already emits camelCase, so this is a thin typed pass-through.
export async function getPriceAction(symbol: string): Promise<PriceAction | null> {
  try {
    return await callSidecar<PriceAction>("/price-action", { symbol });
  } catch {
    return null;
  }
}

// Standing technical-indicator readings (RSI/MACD/Bollinger/SMA distances) from
// the sidecar's /technical/indicators. Complements the technical anomaly feed:
// the anomaly report only carries fresh EVENTS, this carries the current STATE
// (e.g. RSI 80 = overbought even with no new cross). Returns null on any sidecar
// failure — the technical panel still runs on the anomaly text alone. The
// backend already emits camelCase, so this is a thin typed pass-through.
export async function getTechnicalIndicators(symbol: string): Promise<TechnicalIndicators | null> {
  try {
    return await callSidecar<TechnicalIndicators>("/technical/indicators", { symbol });
  } catch {
    return null;
  }
}

// Raw sidecar shape: the SDK's nested {context, update_time, update_time_str}
// objects are preserved by /research/morningstar; we flatten .context here.
interface RawMorningstarText {
  context?: string;
}
interface RawMorningstarResponse {
  symbol: string;
  available: boolean;
  error?: string;
  report?: {
    star_rating?: number | null;
    rating_type?: number | null;
    fair_value?: number | null;
    fair_value_content?: RawMorningstarText | null;
    economic_moat_label?: string | null;
    uncertainty_label?: string | null;
    financial_health_label?: string | null;
    capital_allocation_label?: string | null;
    bull_say?: (RawMorningstarText | null)[] | null;
    bear_say?: (RawMorningstarText | null)[] | null;
    analyst_note_title?: RawMorningstarText | null;
    analyst_note_content?: RawMorningstarText | null;
    investment_thesis_content?: RawMorningstarText | null;
    valuation_content?: RawMorningstarText | null;
    star_update_time_str?: string | null;
    analyst_report_update_time_str?: string | null;
    pdf_url?: string | null;
  } | null;
}

function msText(v: RawMorningstarText | null | undefined): string {
  return (v?.context ?? "").trim();
}
function msTextList(v: (RawMorningstarText | null)[] | null | undefined): string[] {
  return (v ?? []).map(msText).filter(Boolean);
}

// Morningstar research report via the sidecar (OpenD). The News Flow panel's
// self-signal — fair value, moat, uncertainty, bull/bear, analyst note. Returns
// an unavailable report (never throws) so the panel degrades to "n/a" + the
// peer read-through still renders.
export async function getMorningstar(symbol: string): Promise<MorningstarReport> {
  const unavailable: MorningstarReport = {
    symbol,
    available: false,
    starRating: null,
    ratingType: null,
    fairValue: null,
    fairValueNote: "",
    economicMoatLabel: null,
    uncertaintyLabel: null,
    financialHealthLabel: null,
    capitalAllocationLabel: null,
    bullSay: [],
    bearSay: [],
    analystNoteTitle: "",
    analystNote: "",
    investmentThesis: "",
    valuationNote: "",
    starUpdateTimeStr: null,
    analystReportUpdateTimeStr: null,
    pdfUrl: null,
  };
  try {
    const r = await callSidecar<RawMorningstarResponse>("/research/morningstar", { symbol });
    const rep = r.report;
    if (!r.available || !rep) return unavailable;
    return {
      symbol: r.symbol ?? symbol,
      available: true,
      starRating: rep.star_rating ?? null,
      ratingType: rep.rating_type ?? null,
      fairValue: rep.fair_value ?? null,
      fairValueNote: msText(rep.fair_value_content),
      economicMoatLabel: rep.economic_moat_label ?? null,
      uncertaintyLabel: rep.uncertainty_label ?? null,
      financialHealthLabel: rep.financial_health_label ?? null,
      capitalAllocationLabel: rep.capital_allocation_label ?? null,
      bullSay: msTextList(rep.bull_say),
      bearSay: msTextList(rep.bear_say),
      analystNoteTitle: msText(rep.analyst_note_title),
      analystNote: msText(rep.analyst_note_content),
      investmentThesis: msText(rep.investment_thesis_content),
      valuationNote: msText(rep.valuation_content),
      starUpdateTimeStr: rep.star_update_time_str ?? null,
      analystReportUpdateTimeStr: rep.analyst_report_update_time_str ?? null,
      pdfUrl: rep.pdf_url ?? null,
    };
  } catch {
    return unavailable;
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


// Credit-spread screener. Unlike the per-ticker calls above this THROWS on
// failure: an empty candidate list is a legitimate result here, so silently
// swallowing an error would be indistinguishable from "nothing qualifies today".
export async function getScreener(
  dteMin: number,
  dteMax: number,
  limit: number,
): Promise<ScreenerResult> {
  return callSidecar<ScreenerResult>("/screener/credit-spreads", {
    dte_min: String(dteMin),
    dte_max: String(dteMax),
    limit: String(limit),
  });
}

// Per-gate contract counts. Throttled to one screen call per gate server-side,
// so this is on-demand only — never fetch it alongside the screener itself.
export async function getScreenerFunnel(
  dteMin: number,
  dteMax: number,
): Promise<ScreenerFunnel> {
  return callSidecar<ScreenerFunnel>("/screener/funnel", {
    dte_min: String(dteMin),
    dte_max: String(dteMax),
  });
}
