// Types for the wheel plan: vol regime, option chain, acquisition zone and scored strikes.

// hv30Pct is a PROXY for IV Rank built from realized vol — label it as such wherever it surfaces.
export type VolRegimeLabel = "rich" | "fair" | "thin" | "n/a";

export interface VolRegime {
  symbol: string;
  hv30: number | null;        // decimal, annualized (0.41 = 41%)
  hv30Pct: number | null;     // 0-100 within its trailing year
  hv30Low: number | null;
  hv30High: number | null;
  atmIv: number | null;
  expiryUsed: string | null;
  dte: number | null;
  ivHv30: number | null;
  chainError: string | null;   // set when the IV half failed but HV survived
  label: VolRegimeLabel;
  sampleBars: number;         // < 150 forces label "n/a"
}

export interface ChainStrike {
  strike: number;
  delta: number | null;        // signed; |delta| ≈ assignment odds
  bid: number;
  ask: number | null;
  mid: number;
  iv: number | null;           // decimal
  openInterest: number | null;
  volume: number | null;
  spreadPct: number | null;
}

export interface ChainExpiry {
  expiry: string;
  dte: number;
  puts: ChainStrike[];         // at/below spot
  calls: ChainStrike[];        // at/above spot
}

export interface WheelChain {
  symbol: string;
  spot: number;
  expiries: ChainExpiry[];
}

export type ZonePosition = "good" | "fair" | "rich" | "unknown";

export interface AcquisitionZone {
  low: number;
  high: number;
  partial: boolean;            // only two anchors available
  anchors: {
    analystTargetLow: number | null;
    sma200: number | null;
    support: number | null;
  };
}

// No composite score: yield and acquisition quality pull in opposite directions.
export interface ScoredStrike extends ChainStrike {
  annYield: number | null;     // percent, size-independent
  zonePos: ZonePosition;
  clearsLevel: boolean | null;
  effective: number | null;        // basis after the credit: strike − mid (put) or strike + mid (call)
  effectiveVsSpot: number | null;  // percent
  peAtEffective: number | null;    // effective ÷ forward EPS
}

export interface ScoredExpiry {
  expiry: string;
  dte: number;
  atmIv: number | null;        // this expiry's own IV — vol is DTE-specific
  emLower: number | null;      // 1-SD bounds from atmIv over this expiry's dte
  emUpper: number | null;
  earningsInWindow: boolean;
  exDivInWindow: boolean;
  fomcInWindow: boolean;       // flagged, never excluded — see CLAUDE.md
  excluded: string | null;     // non-null means rows is empty
  rows: ScoredStrike[];        // beyond emLower/emUpper, nearest edge first
}

export interface WheelEvents {
  earnings: string | null;
  exDividend: string | null;
  fomc: string[];
}

// Levels arrive nearest-first.
export interface WheelLevels {
  support: number[];
  resistance: number[];
  sma200: number | null;
}

export interface WheelPlan {
  symbol: string;
  ticker: string;
  spot: number | null;
  regime: VolRegime | null;
  zone: AcquisitionZone | null;
  events: WheelEvents;
  levels: WheelLevels;
  forwardEps: number | null;
  putLeg: ScoredExpiry[];
  callLeg: ScoredExpiry[];     // requires shares the app cannot verify
  warning: string | null;
  blocked: boolean;
}
