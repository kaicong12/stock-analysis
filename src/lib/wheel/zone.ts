// The acquisition zone: the band of prices worth owning a name at, and where a strike sits in it.

import type { AcquisitionZone, ZonePosition } from "./types";

interface ZoneInputs {
  analystTargetLow: number | null;
  sma200: number | null;
  support: number | null;
}

// Narrows a value to a usable positive, finite number.
function usable(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

/** Brackets the zone from its anchors, or null when fewer than two are usable. */
export function computeZone(inputs: ZoneInputs): AcquisitionZone | null {
  const anchors = {
    analystTargetLow: usable(inputs.analystTargetLow) ? inputs.analystTargetLow : null,
    sma200: usable(inputs.sma200) ? inputs.sma200 : null,
    support: usable(inputs.support) ? inputs.support : null,
  };
  const values = Object.values(anchors).filter(usable);
  if (values.length < 2) return null;

  return {
    low: Math.min(...values),
    high: Math.max(...values),
    partial: values.length === 2,
    anchors,
  };
}

/** Classifies a put strike against the zone — a price you may be forced to buy at, so cheaper is better. */
export function classifyPutStrike(strike: number, zone: AcquisitionZone | null): ZonePosition {
  if (!zone) return "unknown";
  if (strike < zone.low) return "good";
  if (strike <= zone.high) return "fair";
  return "rich";
}

/** Classifies a call strike against the zone — a price you may be forced to sell at, so the logic inverts. */
export function classifyCallStrike(strike: number, zone: AcquisitionZone | null): ZonePosition {
  if (!zone) return "unknown";
  if (strike > zone.high) return "good";
  if (strike >= zone.low) return "fair";
  return "rich";
}
