// SEC Form 4 insider-transaction client for Massive (ex-Polygon.io).

import { env } from "../env";
import type { InsiderFlowSummary, InsiderResult, InsiderTransaction } from "../types";

const BASE = "https://api.massive.com";

// SEC Form 4 transaction codes.
const TXN_CODE_LABELS: Record<string, string> = {
  P: "Buy (open mkt)",
  S: "Sell (open mkt)",
  A: "Grant/Award",
  D: "Disposition",
  F: "Tax withhold",
  G: "Gift",
  M: "Option exercise",
  X: "Option exercise",
  C: "Conversion",
  W: "Inheritance",
};

// Codes that represent an actual conviction trade in the open market.
const OPEN_MARKET = new Set(["P", "S"]);

interface RawForm4 {
  owner_name?: string;
  officer_title?: string;
  is_director?: boolean;
  is_officer?: boolean;
  is_ten_percent_owner?: boolean;
  filing_date?: string;
  transaction_date?: string;
  transaction_code?: string | null;
  transaction_shares?: number | null;
  transaction_price_per_share?: number | null;
  transaction_value?: number | null;
  shares_owned_following_transaction?: number | null;
  transaction_acquired_disposed?: string | null;
  security_type?: string | null;
  aff_10b5_one?: boolean | null;  // Rule 10b5-1 pre-scheduled-plan flag
}

interface RawEnvelope {
  status?: string;
  results?: RawForm4[];
}

// Picks the most specific role title available for an insider.
function roleLabel(r: RawForm4): string {
  if (r.officer_title && r.officer_title.trim()) return r.officer_title.trim();
  if (r.is_ten_percent_owner) return "10% Owner";
  if (r.is_director) return "Director";
  if (r.is_officer) return "Officer";
  return "Insider";
}

// Converts one vendor Form 4 row into an InsiderTransaction, or null if unusable.
function adapt(r: RawForm4): InsiderTransaction | null {
  const code = (r.transaction_code ?? "").trim().toUpperCase();
  if (!code) return null; // null-code rows exist in the feed; not actionable.
  const shares = r.transaction_shares ?? 0;
  const price = r.transaction_price_per_share ?? 0;
  const isOpenMarket = OPEN_MARKET.has(code);
  const isPlan = r.aff_10b5_one === true;
  const isDiscretionary = isOpenMarket && !isPlan;
  const ownedAfter = r.shares_owned_following_transaction ?? null;
  const denom = ownedAfter === null ? 0 : shares + ownedAfter;
  const pctOfHoldings = denom > 0 ? shares / denom : null;
  const baseLabel = TXN_CODE_LABELS[code] ?? `(${code})`;
  const typeLabel = code === "S" && isPlan ? "Sell (10b5-1)" : baseLabel;
  return {
    name: (r.owner_name ?? "Unknown").trim(),
    title: roleLabel(r),
    code,
    typeLabel,
    isOpenMarket,
    isPlan,
    isDiscretionary,
    transactionDate: r.transaction_date ?? r.filing_date ?? "",
    filingDate: r.filing_date ?? "",
    shares,
    price,
    value: r.transaction_value ?? shares * price,
    sharesOwnedAfter: ownedAfter,
    pctOfHoldings,
    acquiredDisposed: (r.transaction_acquired_disposed ?? "").trim() || null,
  };
}

// Aggregates the transaction set into the flow summary the panel and verdict cite.
function summarize(txns: InsiderTransaction[]): InsiderFlowSummary {
  const buys = txns.filter((t) => t.code === "P");
  const discSells = txns.filter((t) => t.code === "S" && t.isDiscretionary);
  const planSells = txns.filter((t) => t.code === "S" && t.isPlan);
  const buyValue = buys.reduce((a, t) => a + t.value, 0);
  const discSellValue = discSells.reduce((a, t) => a + t.value, 0);
  const planSellValue = planSells.reduce((a, t) => a + t.value, 0);
  const buyers = new Set(buys.map((t) => t.name));
  const discSellers = new Set(discSells.map((t) => t.name));
  return {
    buyCount: buys.length,
    buyValue: Math.round(buyValue),
    distinctBuyers: buyers.size,
    discSellCount: discSells.length,
    discSellValue: Math.round(discSellValue),
    distinctDiscSellers: discSellers.size,
    planSellCount: planSells.length,
    planSellValue: Math.round(planSellValue),
    netConviction: Math.round(buyValue - discSellValue),
    totalFilings: txns.length,
  };
}

// Orders transactions discretionary-first, then plan sells, then the rest, each by value desc.
function rankNotable(txns: InsiderTransaction[], limit: number): InsiderTransaction[] {
  const byValue = (a: InsiderTransaction, b: InsiderTransaction) => b.value - a.value;
  const discretionary = txns.filter((t) => t.isDiscretionary).sort(byValue);
  const planSells = txns.filter((t) => t.code === "S" && t.isPlan).sort(byValue);
  const other = txns.filter((t) => !t.isOpenMarket).sort(byValue);
  return [...discretionary, ...planSells, ...other].slice(0, limit);
}

/** Fetches recent Form 4 activity for a bare ticker; never throws, returning an empty result on failure. */
export async function getInsiderTransactions(
  ticker: string,
  lookbackDays = 45,
  limit = 100,
): Promise<InsiderResult> {
  const empty: InsiderResult = {
    ticker,
    transactions: [],
    notable: [],
    flow: summarize([]),
  };
  if (!env.massiveApiKey) return empty;

  try {
    const since = new Date(Date.now() - lookbackDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const qs = new URLSearchParams({
      "tickers.any_of": ticker,
      "filing_date.gte": since,
      limit: String(limit),
      sort: "filing_date.desc",
      apiKey: env.massiveApiKey,
    });
    const res = await fetch(`${BASE}/stocks/filings/vX/form-4?${qs}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as RawEnvelope;
    const transactions = (json.results ?? [])
      .map(adapt)
      .filter((t): t is InsiderTransaction => t !== null);
    return {
      ticker,
      transactions,
      notable: rankNotable(transactions, 12),
      flow: summarize(transactions),
    };
  } catch {
    return empty;
  }
}
