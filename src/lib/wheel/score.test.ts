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
  it("annualizes credit over the committed capital", () => {
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
        puts: [
          strike({ strike: 165, mid: 4.1 }),
          strike({ strike: 160, mid: 2.85 }),
          strike({ strike: 150, mid: 1.2 }),
          strike({ strike: 145, mid: 0.95 }),
        ],
        calls: [
          strike({ strike: 175, mid: 4.0, delta: 0.3 }),
          strike({ strike: 190, mid: 1.1, delta: 0.1 }),
          strike({ strike: 195, mid: 0.86, delta: 0.08 }),
          strike({ strike: 210, mid: 0.4, delta: 0.03 }),
        ],
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

  it("keeps only put strikes below the band, nearest the edge first", () => {
    const rows = buildWheelPlan(base).putLeg[0].rows;
    // 165 and 160 sit inside the 152.63 lower bound and are dropped.
    expect(rows.map((r) => r.strike)).toEqual([150, 145]);
    // 150 is inside the 148.90-161.20 band, so "fair" — only below 148.90 is good.
    expect(rows.map((r) => r.zonePos)).toEqual(["fair", "good"]);
  });

  it("keeps only call strikes above the band, nearest the edge first", () => {
    const rows = buildWheelPlan(base).callLeg[0].rows;
    // 175 and 190 sit inside the 192.17 upper bound.
    expect(rows.map((r) => r.strike)).toEqual([195, 210]);
    expect(rows[0].zonePos).toBe("good");
    expect(rows[0].clearsLevel).toBe(true);
  });

  it("prices the call leg off spot, not the strike", () => {
    const call = buildWheelPlan(base).callLeg[0].rows.find((r) => r.strike === 195)!;
    // 0.86/172.4 over 30 days, not 0.86/195.
    expect(call.annYield).toBeCloseTo(annualizedYield(0.86, 172.4, 30)!, 2);
  });

  it("passes every strike through when no ATM IV yields a band", () => {
    const noIv: WheelChain = {
      ...chain,
      expiries: [{
        ...chain.expiries[0],
        puts: [strike({ strike: 165, iv: null }), strike({ strike: 160, iv: null })],
        calls: [strike({ strike: 175, iv: null })],
      }],
    };
    const leg = buildWheelPlan({ ...base, chain: noIv }).putLeg[0];
    expect(leg.emLower).toBeNull();
    expect(leg.rows.map((r) => r.strike)).toEqual([165, 160]);
  });

  it("flags clearance against the level", () => {
    const rows = buildWheelPlan(base).putLeg[0].rows;
    expect(rows.find((r) => r.strike === 150)!.clearsLevel).toBe(true);
  });

  it("caps rows so the far tail cannot crowd out the near strikes", () => {
    const many = Array.from({ length: 30 }, (_, i) => strike({ strike: 150 - i, mid: 1.2 }));
    const wide: WheelChain = {
      ...chain,
      expiries: [{ ...chain.expiries[0], puts: many }],
    };
    const rows = buildWheelPlan({ ...base, chain: wide }).putLeg[0].rows;
    expect(rows).toHaveLength(8);
    expect(rows[0].strike).toBe(150);
  });

  it("applies ex-div to the call leg only", () => {
    const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const plan = buildWheelPlan({ ...base, exDividendDate: soon });
    expect(plan.callLeg[0].exDivInWindow).toBe(true);
    expect(plan.putLeg[0].exDivInWindow).toBe(false);
  });

  it("drops an expiry with earnings inside the window instead of warning", () => {
    const soon = new Date(Date.now() + 12 * 86400_000).toISOString().slice(0, 10);
    const plan = buildWheelPlan({ ...base, nextEarningsDate: soon });
    expect(plan.putLeg[0].earningsInWindow).toBe(true);
    expect(plan.putLeg[0].excluded).toBe("earnings inside the window");
    expect(plan.putLeg[0].rows).toEqual([]);
    expect(plan.callLeg[0].rows).toEqual([]);

    const far = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    const ok = buildWheelPlan({ ...base, nextEarningsDate: far }).putLeg[0];
    expect(ok.excluded).toBeNull();
    expect(ok.rows.length).toBeGreaterThan(0);
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
  });

  it("keeps thin and wide-spread strikes — liquidity is not a gate", () => {
    const illiquid: WheelChain = {
      ...chain,
      expiries: [{
        ...chain.expiries[0],
        puts: [strike({ strike: 150, mid: 1.2, openInterest: 10, spreadPct: 40 })],
      }],
    };
    const rows = buildWheelPlan({ ...base, chain: illiquid }).putLeg[0].rows;
    expect(rows.map((r) => r.strike)).toEqual([150]);
  });
});
