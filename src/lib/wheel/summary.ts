import type { PanelSummary } from "../types";
import type { ScoredExpiry, WheelPlan } from "./types";

const money = (x: number | null): string => (x === null ? "—" : `$${x.toFixed(2)}`);

function firstUsable(legs: ScoredExpiry[]): ScoredExpiry | null {
  return legs.find((e) => e.rows.length) ?? null;
}

function bandLine(e: ScoredExpiry): string {
  const iv = e.atmIv === null ? "—" : `${(e.atmIv * 100).toFixed(1)}%`;
  return `${e.expiry} (${e.dte}d) — ATM IV ${iv}, 1-SD band ${money(e.emLower)}–${money(e.emUpper)}`;
}

function legBullet(label: string, legs: ScoredExpiry[]): string {
  const e = firstUsable(legs);
  if (!e) {
    const skipped = legs.find((x) => x.excluded);
    return skipped
      ? `${label}: nothing to show — nearest expiry skipped, ${skipped.excluded}.`
      : `${label}: no strikes beyond the band.`;
  }
  const nearest = e.rows[0];
  const yieldTxt = nearest.annYield === null ? "—" : `${nearest.annYield}%`;
  return `${label}: first strike past the band is ${money(nearest.strike)} at ${money(nearest.mid)} mid (${yieldTxt} annualized, zone: ${nearest.zonePos}).`;
}

export function summarizeWheel(plan: WheelPlan): PanelSummary {
  if (plan.spot === null) {
    return {
      headline: "Chain unavailable",
      bullets: ["No spot price returned, so no expected move could be computed."],
      meta: [],
    };
  }

  const usable = firstUsable(plan.putLeg);
  const skipped = plan.putLeg.filter((e) => e.excluded);
  const bullets = [
    ...plan.putLeg.filter((e) => !e.excluded).map(bandLine),
    ...skipped.map((e) => `${e.expiry} (${e.dte}d) — skipped, ${e.excluded}.`),
    legBullet("Put leg", plan.putLeg),
    legBullet("Call leg (only if you hold 100+ shares)", plan.callLeg),
  ];
  if (plan.warning) bullets.push(plan.warning);

  return {
    headline: usable
      ? `Expected move ${money(usable.emLower)}–${money(usable.emUpper)} through ${usable.expiry}`
      : "No expiry clears the earnings rule",
    bullets,
    conclusion: plan.blocked
      ? "Severe breakdown — no new put entry here."
      : "Sell outside the band, or pass. Sizing happens at your broker.",
    meta: [
      { label: "Spot", value: money(plan.spot) },
      { label: "ATM IV", value: usable?.atmIv == null ? "—" : `${(usable.atmIv * 100).toFixed(1)}%` },
      { label: "1-SD band", value: usable ? `${money(usable.emLower)}–${money(usable.emUpper)}` : "—" },
      { label: "Zone", value: plan.zone ? `${money(plan.zone.low)}–${money(plan.zone.high)}` : "—" },
    ],
  };
}
