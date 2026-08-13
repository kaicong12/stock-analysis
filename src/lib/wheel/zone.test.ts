// Tests for the acquisition zone and its put/call strike classifiers.

import { describe, expect, it } from "vitest";
import { classifyCallStrike, classifyPutStrike, computeZone } from "./zone";

const ANCHORS = { analystTargetLow: 155, sma200: 148.9, support: 161.2 };

describe("computeZone", () => {
  it("brackets the min and max of three anchors", () => {
    const z = computeZone(ANCHORS)!;
    expect(z.low).toBe(148.9);
    expect(z.high).toBe(161.2);
    expect(z.partial).toBe(false);
  });

  it("flags partial with two anchors", () => {
    const z = computeZone({ ...ANCHORS, sma200: null })!;
    expect([z.low, z.high]).toEqual([155, 161.2]);
    expect(z.partial).toBe(true);
  });

  it("returns null below two anchors", () => {
    expect(computeZone({ analystTargetLow: 155, sma200: null, support: null })).toBeNull();
    expect(computeZone({ analystTargetLow: null, sma200: null, support: null })).toBeNull();
  });

  it("rejects non-positive and non-finite anchors rather than bracketing to zero", () => {
    expect(computeZone({ analystTargetLow: 0, sma200: -5, support: 161.2 })).toBeNull();
    expect(computeZone({ analystTargetLow: NaN, sma200: 148.9, support: 161.2 })!.low).toBe(148.9);
  });
});

describe("classifyPutStrike", () => {
  const zone = computeZone(ANCHORS)!;

  it("reads below the zone as a good acquisition price", () => {
    expect(classifyPutStrike(145, zone)).toBe("good");
  });

  it("reads inside the zone as fair, boundaries included", () => {
    expect(classifyPutStrike(155, zone)).toBe("fair");
    expect(classifyPutStrike(148.9, zone)).toBe("fair");
    expect(classifyPutStrike(161.2, zone)).toBe("fair");
  });

  it("reads above the zone as rich — overpaying to get assigned", () => {
    expect(classifyPutStrike(165, zone)).toBe("rich");
  });

  it("is unknown without a zone", () => {
    expect(classifyPutStrike(145, null)).toBe("unknown");
  });
});

describe("classifyCallStrike", () => {
  const zone = computeZone(ANCHORS)!;

  it("inverts the put logic", () => {
    expect(classifyCallStrike(165, zone)).toBe("good");
    expect(classifyCallStrike(155, zone)).toBe("fair");
    expect(classifyCallStrike(145, zone)).toBe("rich");
  });

  it("disagrees with the put classifier at the same strike", () => {
    expect(classifyPutStrike(165, zone)).toBe("rich");
    expect(classifyCallStrike(165, zone)).toBe("good");
  });
});
