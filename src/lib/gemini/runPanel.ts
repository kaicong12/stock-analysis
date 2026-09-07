// Fetches each panel's upstream data and hands it to that panel's analyzer.

import { collatePeerNews, getStockFeed } from "../moomoo/httpApi";
import { getAnomaly, getFundamentals, getMorningstar, getPeers, getTechnicalIndicators } from "../moomoo/sidecar";
import { ticker as toTicker } from "../symbol";
import type { PanelSummary } from "../types";
import type { PanelKey } from "../types";
import {
  analyzeCapital,
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

/** Builds the placeholder summary shown when a panel fails. */
export function panelError(name: string, message: string): PanelSummary {
  return {
    headline: `${name} panel unavailable.`,
    bullets: [],
    direction: "n/a",
    conclusion: `Skill failed: ${message}`,
  };
}

/** Runs one panel end to end: fetch its inputs, then analyze them. */
export async function runPanel(name: PanelKey, ticker: string, symbol: string): Promise<PanelRunResult> {
  const ctx = { ticker, symbol };
  switch (name) {
    case "capital": {
      const data = await getAnomaly("capital", symbol);
      return { summary: await analyzeCapital(data, ctx) };
    }
    case "technical": {
      const [data, indicators] = await Promise.all([
        getAnomaly("technical", symbol),
        getTechnicalIndicators(symbol),
      ]);
      return { summary: await analyzeTechnical(data, ctx, indicators) };
    }
    case "news": {
      const [report, peers] = await Promise.all([getMorningstar(symbol), getPeers(symbol)]);
      const peerTickers = peers.peers.map((p) => toTicker(p.code));
      const peerNews = peerTickers.length ? await collatePeerNews(peerTickers) : [];
      return { summary: await analyzeNews(report, ctx, peerNews) };
    }
    case "digest": {
      return { summary: await analyzeDigest(ctx) };
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
