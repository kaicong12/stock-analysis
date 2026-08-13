// Client for moomoo's public news-search and community-feed endpoints.

import type {
  CommentItem,
  CommentSentimentResult,
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

// Removes HTML tags and collapses whitespace.
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Coerces a vendor timestamp to an epoch number, 0 when unparseable.
function asEpoch(t: string | number): number {
  const n = typeof t === "string" ? Number.parseInt(t, 10) : t;
  return Number.isFinite(n) ? n : 0;
}

// Issues a GET against the news service and parses the JSON envelope.
async function call<T>(path: string, params: Record<string, string>): Promise<RawEnvelope<T>> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`moomoo ${path} ${res.status}`);
  return (await res.json()) as RawEnvelope<T>;
}

// Converts a raw news row into a NewsItem.
function adaptNews(raw: RawNewsItem): NewsItem {
  return {
    id: raw.news_id,
    title: stripHtml(raw.title ?? ""),
    url: raw.url,
    publishTime: asEpoch(raw.publish_time),
    imgUrl: raw.img_url,
  };
}

/** Searches news for a keyword, newest first. */
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

// Converts a raw community-feed row into a CommentItem.
function adaptFeed(raw: RawFeedItem): CommentItem {
  return {
    id: raw.id,
    title: raw.title ? stripHtml(raw.title) : undefined,
    desc: raw.desc ? stripHtml(raw.desc) : undefined,
    url: raw.url ?? `https://www.moomoo.com/community/feed/${raw.id}`,
    publishTime: asEpoch(raw.publish_time),
  };
}

/** Fetches recent community-feed posts for a keyword. */
export async function getStockFeed(keyword: string, size = 30): Promise<CommentSentimentResult> {
  const r = await call<RawFeedItem>("/stock_feed", {
    keyword,
    size: String(size),
  });
  if (r.code !== 0) throw new Error(`moomoo stock_feed code=${r.code}: ${r.message ?? ""}`);
  return { symbol: keyword, posts: (r.data ?? []).map(adaptFeed) };
}

/** Fans news_search out across peer tickers and merges the results, skipping failed peers. */
export async function collatePeerNews(
  peerTickers: string[],
  perPeer = 8,
  max = 64,
): Promise<PeerNewsItem[]> {
  const results = await Promise.allSettled(
    peerTickers.map((t) => searchNews(t, perPeer)),
  );

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

  // Round-robin, not global recency: a pure-recency cut lets one peer's tail crowd out another's head.
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
