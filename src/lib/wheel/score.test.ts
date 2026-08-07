import { describe, expect, it } from "vitest";
import type { PriceAction } from "../types";
import { annualizedYield, breakdownState, buildWheelPlan } from "./score";
import type { ChainStrike, WheelChain } from "./types";
import { computeZone } from "./zone";

function strike(over: Partial<ChainStrike> & { strike: number }): ChainStrike {
  return {
    delta: -0.2,
    bid: 2.8,
    ask: 2.9,
    mid: 2.85,
    iv: 0.4,
    openInterest: 1200,
    volume: 300,
    spreadPct: 3.5,
    ...over,
  };
}

describe("annualizedYield", () => {
  it("annualizes credit over the strike's committed capital", () => {
    // 2.85/160 = 1.78% over 30 days -> x 12.17 periods
    expect(annualizedYield(2.85, 160, 30)).toBeCloseTo(21.67, 1);
  });

  it("scales inversely with DTE for the same credit", () => {
    const short = annualizedYield(2, 100, 15)!;
    const long = annualizedYield(2, 100, 45)!;
    expect(short).toBeCloseTo(long * 3, 1);
  });

  it("returns null on non-positive inputs rather than Infinity or NaN", () => {
    expect(annualizedYield(2.85, 160, 0)).toBeNull();
    expect(annualizedYield(0, 160, 30)).toBeNull();
    expect(annualizedYield(2.85, 0, 30)).toBeNull();
  });
});

describe("breakdownState", () => {
  const pa = (over: Partial<PriceAction>): PriceAction =>
    ({ signal: "breakdown", severity: "mild", reasons: ["9.2% below 50d MA"], ...over }) as PriceAction;

  it("blocks a severe breakdown", () => {
    const s = breakdownState(pa({ severity: "severe" }));
    expect(s.blocked).toBe(true);
    expect(s.warning).toContain("9.2% below 50d MA");
  });

  it("warns but allows a mild breakdown — the dip is partly the point", () => {
    const s = breakdownState(pa({ severity: "mild" }));
    expect(s.blocked).toBe(false);
    expect(s.warning).toContain("acquisition-zone floor");
  });

  it("is inert without a breakdown", () => {
    expect(breakdownState(null)).toEqual({ warning: null, blocked: false });
    expect(breakdownState(pa({ signal: "none" }))).toEqual({ warning: null, blocked: false });
  });
});

describe("buildWheelPlan", () => {
  const chain: WheelChain = {
    symbol: "US.NVDA",
    spot: 172.4,
    expiries: [
      {
        expiry: "2026-09-04",
        dte: 30,
        // atmIv is read off the strike nearest spot -> 0.40 here.
        puts: [strike({ strike: 165, mid: 4.1 }), strike({ strike: 160, mid: 2.85 }), strike({ strike: 150, mid: 1.2 })],
        calls: [strike({ strike: 175, mid: 4.0, delta: 0.3 }), strike({ strike: 190, mid: 1.1, delta: 0.1 })],
      },
    ],
  };
  const base = {
    symbol: "US.NVDA",
    ticker: "NVDA",
    chain,
    regime: null,
    zone: computeZone({ analystTargetLow: 155, sma200: 148.9, support: 161.2 }),
    support: 161.2,
    resistance: 178,
    priceAction: null,
    nextEarningsDate: null,
    exDividendDate: null,
  };

  it("derives the expected move from the expiry's own ATM IV", () => {
    const leg = buildWheelPlan(base).putLeg[0];
    // 172.4 * 0.40 * sqrt(30/365) = 19.77
    expect(leg.atmIv).toBe(0.4);
    expect(leg.emLower).toBeCloseTo(152.63, 1);
    expect(leg.emUpper).toBeCloseTo(192.17, 1);
  });

  it("classifies put strikes against the zone and orders nearest-the-money first", () => {
    const rows = buildWheelPlan(base).putLeg[0].rows;
    expect(rows.map((r) => r.strike)).toEqual([165, 160, 150]);
    // 150 is inside the 148.90-161.20 band, so "fair" — only below 148.90 is good.
    expect(rows.map((r) => r.zonePos)).toEqual(["rich", "fair", "fair"]);
  });

  it("reads a strike below every anchor as a good acquisition price", () => {
    const deep: WheelChain = {
      ...chain,
      expiries: [{ ...chain.expiries[0], puts: [strike({ strike: 140, mid: 0.9 })] }],
    };
    expect(buildWheelPlan({ ...base, chain: deep }).putLeg[0].rows[0].zonePos).toBe("good");
  });

  it("marks the furthest-out row safest and never marks a rich strike richest", () => {
    const rows = buildWheelPlan(base).putLeg[0].rows;
    expect(rows.find((r) => r.safest)?.strike).toBe(150);
    // 165 pays the most but sits above the zone, so it is excluded.
    const richest = rows.find((r) => r.richest);
    expect(richest?.strike).toBe(160);
  });

  it("flags clearance against both the level and the expected move", () => {
    const rows = buildWheelPlan(base).putLeg[0].rows;
    const r150 = rows.find((r) => r.strike === 150)!;
    const r160 = rows.find((r) => r.strike === 160)!;
    expect(r150.clearsEm).toBe(true);
    expect(r150.clearsLevel).toBe(true);
    // 160 is below support 161.2 but inside the 152.63 lower bound.
    expect(r160.clearsLevel).toBe(true);
    expect(r160.clearsEm).toBe(false);
  });

  it("inverts strike order and zone reading on the call leg", () => {
    const rows = buildWheelPlan(base).callLeg[0].rows;
    expect(rows.map((r) => r.strike)).toEqual([175, 190]);
    expect(rows.find((r) => r.strike === 190)!.zonePos).toBe("good");
    expect(rows.find((r) => r.strike === 190)!.clearsLevel).toBe(true);
  });

  it("applies ex-div to the call leg only", () => {
    const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const plan = buildWheelPlan({ ...base, exDividendDate: soon });
    expect(plan.callLeg[0].exDivInWindow).toBe(true);
    expect(plan.putLeg[0].exDivInWindow).toBe(false);
  });

  it("flags earnings inside the window on both legs", () => {
    const soon = new Date(Date.now() + 12 * 86400_000).toISOString().slice(0, 10);
    const plan = buildWheelPlan({ ...base, nextEarningsDate: soon });
    expect(plan.putLeg[0].earningsInWindow).toBe(true);
    const far = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    expect(buildWheelPlan({ ...base, nextEarningsDate: far }).putLeg[0].earningsInWindow).toBe(false);
  });

  it("returns empty legs without a chain instead of throwing", () => {
    const plan = buildWheelPlan({ ...base, chain: null });
    expect(plan.putLeg).toEqual([]);
    expect(plan.callLeg).toEqual([]);
    expect(plan.zone).not.toBeNull();
  });

  it("leaves zone position unknown when no zone could be built", () => {
    const plan = buildWheelPlan({ ...base, zone: null });
    expect(plan.putLeg[0].rows.every((r) => r.zonePos === "unknown")).toBe(true);
    // With every row "unknown" rather than "rich", richest still has candidates.
    expect(plan.putLeg[0].rows.some((r) => r.richest)).toBe(true);
  });

  it("excludes illiquid rows from the safest and richest marks", () => {
    const illiquid: WheelChain = {
      ...chain,
      expiries: [{
        ...chain.expiries[0],
        puts: [strike({ strike: 160, mid: 2.85 }), strike({ strike: 150, mid: 1.2, openInterest: 10, spreadPct: 40 })],
      }],
    };
    const rows = buildWheelPlan({ ...base, chain: illiquid }).putLeg[0].rows;
    expect(rows.find((r) => r.strike === 150)!.liquid).toBe(false);
    expect(rows.find((r) => r.safest)?.strike).toBe(160);
  });
});
