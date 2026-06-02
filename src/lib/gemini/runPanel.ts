import { collatePeerNews, getStockFeed, newsForDigest, searchNews } from "../moomoo/httpApi";
import { getAnomaly, getFundamentals, getPeers, getVolSummary } from "../moomoo/sidecar";
import { ticker as toTicker } from "../symbol";
import type { PanelSummary } from "../types";
import type { PanelKey } from "../batch/protocol";
import {
  analyzeCapital,
  analyzeDerivatives,
  analyzeDigest,
  analyzeFundamentals,
  analyzeNews,
  analyzeSentiment,
  analyzeTechnical,
} from "./panels";

export interface PanelRunResult {
  summary: PanelSummary;
  nextEarningsDate?: string | null;
}

export function panelError(name: string, message: string): PanelSummary {
  return {
    headline: `${name} panel unavailable.`,
    bullets: [],
    direction: "n/a",
    conclusion: `Skill failed: ${message}`,
  };
}

export async function runPanel(name: PanelKey, ticker: string, symbol: string): Promise<PanelRunResult> {
  const ctx = { ticker, symbol };
  switch (name) {
    case "capital": {
      const data = await getAnomaly("capital", symbol);
      return { summary: await analyzeCapital(data, ctx) };
    }
    case "technical": {
      const data = await getAnomaly("technical", symbol);
      return { summary: await analyzeTechnical(data, ctx) };
    }
    case "derivatives": {
      // Fetch the anomaly report and the structured vol summary in parallel —
      // they hit different upstreams (moomoo /anomaly/derivatives vs.
      // moomoo chain + yfinance daily closes) and the panel uses both.
      const [data, vol] = await Promise.all([
        getAnomaly("derivatives", symbol),
        getVolSummary(symbol),
      ]);
      return { summary: await analyzeDerivatives(data, ctx, vol) };
    }
    case "news": {
      // Self news + the peer graph in parallel. getPeers never throws (returns
      // an empty list on any failure), so the self-news block always renders.
      const [data, peers] = await Promise.all([searchNews(ticker), getPeers(symbol)]);
      const peerTickers = peers.peers.map((p) => toTicker(p.code));
      const peerNews = peerTickers.length ? await collatePeerNews(peerTickers) : [];
      return { summary: await analyzeNews(data, ctx, peerNews) };
    }
    case "digest": {
      const data = await newsForDigest(ticker);
      return { summary: await analyzeDigest(data, ctx) };
    }
    case "sentiment": {
      const data = await getStockFeed(ticker);
      return { summary: await analyzeSentiment(data, ctx) };
    }
    case "fundamentals": {
      const data = await getFundamentals(symbol);
      return {
        summary: await analyzeFundamentals(data, ctx),
        nextEarningsDate: data?.data?.nextEarningsDate ?? null,
      };
    }
  }
}
