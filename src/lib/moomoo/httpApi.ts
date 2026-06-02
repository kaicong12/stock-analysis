import type {
  CommentItem,
  CommentSentimentResult,
  DigestResult,
  NewsItem,
  NewsResult,
  PeerNewsItem,
} from "../types";

const BASE = "https://ai-news-search.moomoo.com";
const UA = "stock-analysis/0.1";

interface RawNewsItem {
  news_id: string;
  news_type: number;
  title: string;
  publish_time: string | number;
  url: string;
  img_url?: string;
}

interface RawFeedItem {
  id: string;
  title?: string;
  desc?: string;
  publish_time: string | number;
  url?: string;
}

interface RawEnvelope<T> {
  code: number;
  message?: string;
  data: T[];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function asEpoch(t: string | number): number {
  const n = typeof t === "string" ? Number.parseInt(t, 10) : t;
  return Number.isFinite(n) ? n : 0;
}

async function call<T>(path: string, params: Record<string, string>): Promise<RawEnvelope<T>> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`moomoo ${path} ${res.status}`);
  return (await res.json()) as RawEnvelope<T>;
}

function adaptNews(raw: RawNewsItem): NewsItem {
  return {
    id: raw.news_id,
    title: stripHtml(raw.title ?? ""),
    url: raw.url,
    publishTime: asEpoch(raw.publish_time),
    imgUrl: raw.img_url,
  };
}

export async function searchNews(keyword: string, size = 10): Promise<NewsResult> {
  const r = await call<RawNewsItem>("/news_search", {
    keyword,
    size: String(size),
    news_type: "1",
    lang: "en",
    sort_type: "2",
  });
  if (r.code !== 0) throw new Error(`moomoo news_search code=${r.code}: ${r.message ?? ""}`);
  return { symbol: keyword, items: (r.data ?? []).map(adaptNews) };
}

export async function newsForDigest(keyword: string, size = 12): Promise<DigestResult> {
  const r = await call<RawNewsItem>("/news_search", {
    keyword,
    size: String(size),
    news_type: "1",
    lang: "en",
    sort_type: "2",
  });
  if (r.code !== 0) throw new Error(`moomoo digest code=${r.code}: ${r.message ?? ""}`);
  return { symbol: keyword, items: (r.data ?? []).map(adaptNews) };
}

function adaptFeed(raw: RawFeedItem): CommentItem {
  return {
    id: raw.id,
    title: raw.title ? stripHtml(raw.title) : undefined,
    desc: raw.desc ? stripHtml(raw.desc) : undefined,
    url: raw.url ?? `https://www.moomoo.com/community/feed/${raw.id}`,
    publishTime: asEpoch(raw.publish_time),
  };
}

export async function getStockFeed(keyword: string, size = 30): Promise<CommentSentimentResult> {
  const r = await call<RawFeedItem>("/stock_feed", {
    keyword,
    size: String(size),
  });
  if (r.code !== 0) throw new Error(`moomoo stock_feed code=${r.code}: ${r.message ?? ""}`);
  return { symbol: keyword, posts: (r.data ?? []).map(adaptFeed) };
}

// Stage A of the peer read-through pipeline: fan out news_search across the
// peer tickers (parallel — the endpoint is a CDN service, no throttling at this
// scale), tag each item with its source peer, dedup by news_id. Pure HTTP +
// merge — no LLM; the LLM relevance/clustering happens downstream in analyzeNews.
// A failed peer is skipped, not fatal.
//
// Ordering is ROUND-ROBIN across peers, NOT global recency. A pure-recency
// truncation used to starve a peer of its single most decision-relevant (but
// not most recent) headline — e.g. "NVIDIA enters the PC market" landing one
// slot past the cutoff while fresher fund-flow/PR noise from NVDA survived, so
// the LLM saw only noise and dropped NVDA entirely. Round-robin guarantees each
// peer's top items reach the model before any peer's deep tail.
export async function collatePeerNews(
  peerTickers: string[],
  perPeer = 8,
  max = 64,
): Promise<PeerNewsItem[]> {
  const results = await Promise.allSettled(
    peerTickers.map((t) => searchNews(t, perPeer)),
  );

  // Per-peer lists, deduped globally by news_id; each peer keeps its own
  // recency order.
  const seen = new Set<string>();
  const lists: PeerNewsItem[][] = results.map((res, i) => {
    if (res.status !== "fulfilled") return [];
    const out: PeerNewsItem[] = [];
    for (const it of res.value.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({
        source: peerTickers[i],
        title: it.title,
        url: it.url,
        publishTime: it.publishTime,
      });
    }
    return out;
  });

  // Interleave: peer0[0], peer1[0], …, peer0[1], peer1[1], … so no peer's tail
  // crowds out another peer's head.
  const merged: PeerNewsItem[] = [];
  const depth = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let d = 0; d < depth && merged.length < max; d++) {
    for (const list of lists) {
      if (d < list.length) {
        merged.push(list[d]);
        if (merged.length >= max) break;
      }
    }
  }
  return merged;
}
