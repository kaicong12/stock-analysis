// Insider-transaction client for Massive (the data vendor formerly known as
// Polygon.io — api.polygon.io now 301-redirects to api.massive.com). Pulls SEC
// Form 4 filings (same underlying data as EDGAR) but as clean JSON, so we don't
// hand-parse the per-filing XML.
//
// Mirrors the getPeers contract: NEVER throws. On any failure (missing key,
// network, vendor 4xx) it returns an empty result so the insider panel degrades
// to "No insider data" instead of taking down the whole dashboard run.

import { env } from "../env";
import type { InsiderFlowSummary, InsiderResult, InsiderTransaction } from "../types";

const BASE = "https://api.massive.com";

// SEC Form 4 transaction codes. Only P (open-market buy) and S (open-market
// sell) carry directional conviction; the rest are compensation/admin plumbing
// that is mostly noise for a trading signal. The S label is refined to
// "Sell (10b5-1)" downstream when the trade was made under a pre-scheduled plan.
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
  // Rule 10b5-1 pre-scheduled-plan flag. When true, the trade was committed to
  // months in advance and carries no directional conviction.
  aff_10b5_one?: boolean | null;
}

interface RawEnvelope {
  status?: string;
  results?: RawForm4[];
}

function roleLabel(r: RawForm4): string {
  if (r.officer_title && r.officer_title.trim()) return r.officer_title.trim();
  if (r.is_ten_percent_owner) return "10% Owner";
  if (r.is_director) return "Director";
  if (r.is_officer) return "Officer";
  return "Insider";
}

function adapt(r: RawForm4): InsiderTransaction | null {
  const code = (r.transaction_code ?? "").trim().toUpperCase();
  if (!code) return null; // null-code rows exist in the feed; not actionable.
  const shares = r.transaction_shares ?? 0;
  const price = r.transaction_price_per_share ?? 0;
  const isOpenMarket = OPEN_MARKET.has(code);
  const isPlan = r.aff_10b5_one === true;
  // Discretionary = open-market AND not under a 10b5-1 plan. Buys are always
  // discretionary; only NON-plan sells count as a bearish conviction signal.
  const isDiscretionary = isOpenMarket && !isPlan;
  const ownedAfter = r.shares_owned_following_transaction ?? null;
  const denom = ownedAfter === null ? 0 : shares + ownedAfter;
  const pctOfHoldings = denom > 0 ? shares / denom : null;
  // A 10b5-1 sell is still a sell, but flag it as routine in the label so the
  // panel and UI never mistake it for a conviction trade.
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

// Deterministic aggregates over the transaction set. Computed in code (NOT by
// the LLM) so the headline numbers the panel and verdict cite are always exact —
// the analyzer LLM only writes the narrative around these figures.
//
// The directional read keys off DISCRETIONARY flow only: open-market buys (all
// discretionary) minus non-plan open-market sells. Routine 10b5-1 plan sells are
// counted separately and excluded from netConviction — without this split, every
// large-cap reads falsely bearish because mega-cap insider selling is dominated
// by pre-scheduled comp diversification, not conviction.
function summarize(txns: InsiderTransaction[]): InsiderFlowSummary {
  const buys = txns.filter((t) => t.code === "P"); // always discretionary
  const discSells = txns.filter((t) => t.code === "S" && t.isDiscretionary);
  const planSells = txns.filter((t) => t.code === "S" && t.isPlan);
  const buyValue = buys.reduce((a, t) => a + t.value, 0);
  const discSellValue = discSells.reduce((a, t) => a + t.value, 0);
  const planSellValue = planSells.reduce((a, t) => a + t.value, 0);
  // Distinct insiders on each side — a cluster of DIFFERENT insiders trading
  // discretionarily is the high-signal pattern (one insider can trade for many
  // reasons; several doing it the same week is conviction).
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

// Notable transactions for the panel/prompt: DISCRETIONARY open-market trades
// first (the only conviction signal), then routine 10b5-1 sells, then the
// largest comp plumbing for context — each tier sorted by dollar value desc.
// Capped so the prompt stays compact.
function rankNotable(txns: InsiderTransaction[], limit: number): InsiderTransaction[] {
  const byValue = (a: InsiderTransaction, b: InsiderTransaction) => b.value - a.value;
  const discretionary = txns.filter((t) => t.isDiscretionary).sort(byValue);
  const planSells = txns.filter((t) => t.code === "S" && t.isPlan).sort(byValue);
  const other = txns.filter((t) => !t.isOpenMarket).sort(byValue);
  return [...discretionary, ...planSells, ...other].slice(0, limit);
}

// Fetch recent Form 4 activity for a bare ticker (e.g. "NFLX"). `lookbackDays`
// bounds the window; `limit` caps rows (the vendor paginates beyond this via
// next_url, which we intentionally don't follow — recent activity is the signal).
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
