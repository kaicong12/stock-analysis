// The band of prices worth owning this name at, bracketed from three anchors
// that already arrive on every run: the street's bear case, the long-term trend
// floor, and where buyers actually showed up.

import type { AcquisitionZone, ZonePosition } from "./types";

interface ZoneInputs {
  analystTargetLow: number | null;
  sma200: number | null;
  support: number | null;
}

function usable(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

export function computeZone(inputs: ZoneInputs): AcquisitionZone | null {
  const anchors = {
    analystTargetLow: usable(inputs.analystTargetLow) ? inputs.analystTargetLow : null,
    sma200: usable(inputs.sma200) ? inputs.sma200 : null,
    support: usable(inputs.support) ? inputs.support : null,
  };
  const values = Object.values(anchors).filter(usable);
  // A band from one anchor is just that number, dressed up as a range.
  if (values.length < 2) return null;

  return {
    low: Math.min(...values),
    high: Math.max(...values),
    partial: values.length === 2,
    anchors,
  };
}

// A put strike is a price you may be forced to BUY at, so cheaper is better.
export function classifyPutStrike(strike: number, zone: AcquisitionZone | null): ZonePosition {
  if (!zone) return "unknown";
  if (strike < zone.low) return "good";
  if (strike <= zone.high) return "fair";
  return "rich";
}

// A call strike is a price you may be forced to SELL at, so the logic inverts.
export function classifyCallStrike(strike: number, zone: AcquisitionZone | null): ZonePosition {
  if (!zone) return "unknown";
  if (strike > zone.high) return "good";
  if (strike >= zone.low) return "fair";
  return "rich";
}
