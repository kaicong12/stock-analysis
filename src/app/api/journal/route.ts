import type { NextRequest } from "next/server";
import { createTrade, listTrades } from "../../../lib/journal/db";
import type {
  JournalLegInput,
  JournalStatus,
  JournalStrategy,
  JournalTradeInput,
} from "../../../lib/journal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STRATEGIES: JournalStrategy[] = [
  "SELL_CASH_SECURED_PUT",
  "SELL_COVERED_CALL",
  "SELL_PUT_SPREAD",
  "SELL_CALL_SPREAD",
  "BUY_CALL_SPREAD",
  "BUY_PUT_SPREAD",
  "IRON_CONDOR",
  "LONG_CALL",
  "LONG_PUT",
  "CUSTOM",
];

function isJournalStrategy(s: unknown): s is JournalStrategy {
  return typeof s === "string" && (VALID_STRATEGIES as string[]).includes(s);
}

function parseLegs(raw: unknown): JournalLegInput[] | null {
  if (!Array.isArray(raw)) return null;
  const legs: JournalLegInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    if (o.side !== "C" && o.side !== "P") return null;
    if (o.action !== "BUY" && o.action !== "SELL") return null;
    if (typeof o.strike !== "number" || !Number.isFinite(o.strike) || o.strike <= 0) return null;
    const deltaAtEntry =
      o.deltaAtEntry === null || o.deltaAtEntry === undefined
        ? null
        : typeof o.deltaAtEntry === "number" && Number.isFinite(o.deltaAtEntry)
          ? o.deltaAtEntry
          : NaN;
    if (Number.isNaN(deltaAtEntry)) return null;
    const conid =
      o.conid === null || o.conid === undefined
        ? null
        : typeof o.conid === "number" && Number.isInteger(o.conid)
          ? o.conid
          : NaN;
    if (Number.isNaN(conid)) return null;
    legs.push({
      side: o.side,
      action: o.action,
      strike: o.strike,
      deltaAtEntry,
      conid,
    });
  }
  return legs;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const ticker = url.searchParams.get("ticker") ?? undefined;
  const status: JournalStatus | undefined =
    statusParam === "open" || statusParam === "closed" ? statusParam : undefined;
  try {
    const trades = listTrades({ status, ticker });
    return Response.json({ trades });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[journal GET] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.ticker !== "string" || !body.ticker.trim()) {
    return Response.json({ error: "ticker is required" }, { status: 400 });
  }
  if (!isJournalStrategy(body.strategy)) {
    return Response.json({ error: "strategy is required and must be a known JournalStrategy" }, { status: 400 });
  }
  if (typeof body.expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiry)) {
    return Response.json({ error: "expiry must be ISO YYYY-MM-DD" }, { status: 400 });
  }
  if (typeof body.dteAtEntry !== "number" || !Number.isInteger(body.dteAtEntry)) {
    return Response.json({ error: "dteAtEntry must be an integer" }, { status: 400 });
  }
  if (typeof body.netCredit !== "number" || !Number.isFinite(body.netCredit)) {
    return Response.json({ error: "netCredit is required (per spread, $)" }, { status: 400 });
  }
  if (typeof body.maxRisk !== "number" || !Number.isFinite(body.maxRisk) || body.maxRisk <= 0) {
    return Response.json({ error: "maxRisk is required and must be > 0" }, { status: 400 });
  }
  if (typeof body.contracts !== "number" || !Number.isInteger(body.contracts) || body.contracts <= 0) {
    return Response.json({ error: "contracts must be a positive integer" }, { status: 400 });
  }
  if (typeof body.thesis !== "string" || !body.thesis.trim()) {
    return Response.json({ error: "thesis is required" }, { status: 400 });
  }
  if (typeof body.mgmtProfit !== "string" || !body.mgmtProfit.trim()) {
    return Response.json({ error: "mgmtProfit is required" }, { status: 400 });
  }
  if (typeof body.mgmtLoss !== "string" || !body.mgmtLoss.trim()) {
    return Response.json({ error: "mgmtLoss is required" }, { status: 400 });
  }
  const ivRank =
    body.ivRank === null || body.ivRank === undefined
      ? null
      : typeof body.ivRank === "number" && Number.isFinite(body.ivRank) && body.ivRank >= 0 && body.ivRank <= 100
        ? body.ivRank
        : NaN;
  if (Number.isNaN(ivRank)) {
    return Response.json({ error: "ivRank must be null or a number in [0, 100]" }, { status: 400 });
  }
  const legs = parseLegs(body.legs);
  if (!legs || legs.length === 0) {
    return Response.json({ error: "legs must be a non-empty array of {side, action, strike, deltaAtEntry, conid}" }, { status: 400 });
  }

  const input: JournalTradeInput = {
    ticker: body.ticker.trim().toUpperCase(),
    strategy: body.strategy,
    expiry: body.expiry,
    dteAtEntry: body.dteAtEntry,
    ivRank,
    netCredit: body.netCredit,
    maxRisk: body.maxRisk,
    contracts: body.contracts,
    thesis: body.thesis.trim(),
    mgmtProfit: body.mgmtProfit.trim(),
    mgmtLoss: body.mgmtLoss.trim(),
    legs,
  };

  try {
    const trade = createTrade(input);
    return Response.json({ trade }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[journal POST] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
