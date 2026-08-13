// Types for the market-wide daily digest. Ticker-independent: one cycle serves every page load.

export interface TapeQuote {
  key: string;
  label: string;
  yfTicker: string;
  last: number | null;
  prevClose: number | null;
  changePct: number | null;
  asOf: string | null;
}

export interface VixRank {
  last: number;
  pct: number | null;
  // VIX is itself implied vol, so this needs no "proxy for IV Rank" caveat.
  barsRanked: number;
  low: number;
  high: number;
}

export interface MarketTape {
  asOf: string | null;
  quotes: TapeQuote[];
  vix: VixRank | null;
  errors: { source: string; message: string }[];
}

export const DIGEST_SECTION_KEYS = ["movers", "vol", "runway", "risk"] as const;
export type DigestSectionKey = (typeof DIGEST_SECTION_KEYS)[number];

export interface PooledHeadline {
  id: string;
  title: string;
  url: string;
  publishTime: number;
  keyword: string;
}

export interface DigestCitation {
  title: string;
  url: string;
  publishedAt: string;
}

export interface DigestSection {
  key: DigestSectionKey;
  headline: string;
  bullets: string[];
  citations: DigestCitation[];
  status: "ready" | "unavailable";
}

export interface MarketDigestResult {
  generatedAt: string;
  asOf: string | null;
  topLine: string | null;
  tape: MarketTape | null;
  sections: DigestSection[];
  scoutKeywords: string[];
  errors: { source: string; message: string }[];
}
