import { describe, expect, it } from "vitest";
import { formatPool, interleaveDedup, resolveCitations, withinAge } from "./sources";
import type { PooledHeadline } from "./types";

const NOW_MS = Date.UTC(2026, 7, 13, 12, 0, 0);

function h(id: string, opts: Partial<PooledHeadline> = {}): PooledHeadline {
  return {
    id,
    title: `headline ${id}`,
    url: `https://example.com/${id}`,
    publishTime: Math.floor(NOW_MS / 1000) - 3600,
    keyword: "kw",
    ...opts,
  };
}

describe("interleaveDedup", () => {
  it("takes one from each list before any list's second item", () => {
    const out = interleaveDedup([[h("a1"), h("a2")], [h("b1"), h("b2")]], 10);
    expect(out.map((x) => x.id)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("drops ids already taken from an earlier list", () => {
    const out = interleaveDedup([[h("dup"), h("a2")], [h("dup"), h("b2")]], 10);
    expect(out.map((x) => x.id)).toEqual(["dup", "a2", "b2"]);
  });

  it("caps at max", () => {
    const out = interleaveDedup([[h("a1"), h("a2"), h("a3")]], 2);
    expect(out).toHaveLength(2);
  });

  it("does not let a long list starve a short one at the cap", () => {
    const long = [h("a1"), h("a2"), h("a3"), h("a4")];
    const out = interleaveDedup([long, [h("b1")]], 2);
    expect(out.map((x) => x.id)).toEqual(["a1", "b1"]);
  });

  it("skips gaps in ragged lists", () => {
    const out = interleaveDedup([[h("a1")], [h("b1"), h("b2")]], 10);
    expect(out.map((x) => x.id)).toEqual(["a1", "b1", "b2"]);
  });

  it("returns empty for no lists", () => {
    expect(interleaveDedup([], 10)).toEqual([]);
    expect(interleaveDedup([[], []], 10)).toEqual([]);
  });
});

describe("withinAge", () => {
  const hoursAgo = (n: number) => Math.floor(NOW_MS / 1000) - n * 3600;

  it("keeps items inside the window", () => {
    const out = withinAge([h("fresh", { publishTime: hoursAgo(2) })], NOW_MS, 72);
    expect(out.map((x) => x.id)).toEqual(["fresh"]);
  });

  it("drops items older than the window", () => {
    const out = withinAge([h("stale", { publishTime: hoursAgo(100) })], NOW_MS, 72);
    expect(out).toEqual([]);
  });

  it("keeps Friday news on a Monday run at the default window", () => {
    const out = withinAge([h("friday", { publishTime: hoursAgo(70) })], NOW_MS);
    expect(out.map((x) => x.id)).toEqual(["friday"]);
  });

  it("drops items with an unparseable timestamp", () => {
    expect(withinAge([h("undated", { publishTime: 0 })], NOW_MS)).toEqual([]);
  });
});

describe("formatPool", () => {
  it("numbers entries from 1 so the model's cites map back", () => {
    const text = formatPool([h("a"), h("b")], NOW_MS);
    expect(text).toContain("[1] ");
    expect(text).toContain("[2] ");
    expect(text).toContain("headline a");
  });

  it("never emits a URL the model could copy", () => {
    expect(formatPool([h("a")], NOW_MS)).not.toContain("https://");
  });

  it("says so plainly when the pool is empty", () => {
    expect(formatPool([], NOW_MS)).toBe("(no headlines in the window)");
  });
});

describe("resolveCitations", () => {
  const pool = [h("a"), h("b"), h("c")];

  it("maps 1-based indexes onto real headlines", () => {
    const out = resolveCitations(pool, [1, 3]);
    expect(out.map((c) => c.url)).toEqual([
      "https://example.com/a",
      "https://example.com/c",
    ]);
  });

  it("drops out-of-range indexes instead of inventing a source", () => {
    expect(resolveCitations(pool, [9, 0, -1, 2]).map((c) => c.url)).toEqual([
      "https://example.com/b",
    ]);
  });

  it("drops duplicate picks", () => {
    expect(resolveCitations(pool, [2, 2, 2])).toHaveLength(1);
  });

  it("drops non-integer indexes", () => {
    expect(resolveCitations(pool, [1.5, Number.NaN])).toEqual([]);
  });

  it("caps the citation count", () => {
    expect(resolveCitations(pool, [1, 2, 3], 2)).toHaveLength(2);
  });

  it("handles a missing cites array", () => {
    expect(resolveCitations(pool, undefined)).toEqual([]);
  });

  it("emits an ISO publishedAt", () => {
    const [c] = resolveCitations([h("a", { publishTime: 1_770_000_000 })], [1]);
    expect(c.publishedAt).toBe(new Date(1_770_000_000 * 1000).toISOString());
  });
});
