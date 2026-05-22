import { getStockFeed, newsForDigest, searchNews } from "../moomoo/httpApi";
import { getAnomaly, getFundamentals } from "../moomoo/sidecar";
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
      const data = await getAnomaly("derivatives", symbol);
      return { summary: await analyzeDerivatives(data, ctx) };
    }
    case "news": {
      const data = await searchNews(ticker);
      return { summary: await analyzeNews(data, ctx) };
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
