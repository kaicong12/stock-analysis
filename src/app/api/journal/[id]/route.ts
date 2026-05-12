import type { NextRequest } from "next/server";
import { deleteTrade, getTrade, updateTrade } from "../../../../lib/journal/db";
import type { JournalTradeInput } from "../../../../lib/journal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(idStr: string): number | null {
  const n = Number(idStr);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id: idStr } = await ctx.params;
  const id = parseId(idStr);
  if (id === null) return Response.json({ error: "id must be a positive integer" }, { status: 400 });
  try {
    const trade = getTrade(id);
    if (!trade) return Response.json({ error: "trade not found" }, { status: 404 });
    return Response.json({ trade });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[journal GET id] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id: idStr } = await ctx.params;
  const id = parseId(idStr);
  if (id === null) return Response.json({ error: "id must be a positive integer" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // Whitelist + lightweight validation. Legs are immutable in v1 (delete + recreate to change them).
  const patch: Partial<Omit<JournalTradeInput, "legs">> = {};
  if (body.ticker !== undefined) {
    if (typeof body.ticker !== "string" || !body.ticker.trim()) {
      return Response.json({ error: "ticker must be a non-empty string" }, { status: 400 });
    }
    patch.ticker = body.ticker.trim().toUpperCase();
  }
  if (body.strategy !== undefined) {
    if (typeof body.strategy !== "string") return Response.json({ error: "strategy must be a string" }, { status: 400 });
    patch.strategy = body.strategy as JournalTradeInput["strategy"];
  }
  if (body.expiry !== undefined) {
    if (typeof body.expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiry)) {
      return Response.json({ error: "expiry must be ISO YYYY-MM-DD" }, { status: 400 });
    }
    patch.expiry = body.expiry;
  }
  if (body.dteAtEntry !== undefined) {
    if (typeof body.dteAtEntry !== "number" || !Number.isInteger(body.dteAtEntry)) {
      return Response.json({ error: "dteAtEntry must be an integer" }, { status: 400 });
    }
    patch.dteAtEntry = body.dteAtEntry;
  }
  if (body.netCredit !== undefined) {
    if (typeof body.netCredit !== "number" || !Number.isFinite(body.netCredit)) {
      return Response.json({ error: "netCredit must be a number" }, { status: 400 });
    }
    patch.netCredit = body.netCredit;
  }
  if (body.maxRisk !== undefined) {
    if (typeof body.maxRisk !== "number" || !Number.isFinite(body.maxRisk) || body.maxRisk <= 0) {
      return Response.json({ error: "maxRisk must be > 0" }, { status: 400 });
    }
    patch.maxRisk = body.maxRisk;
  }
  if (body.contracts !== undefined) {
    if (typeof body.contracts !== "number" || !Number.isInteger(body.contracts) || body.contracts <= 0) {
      return Response.json({ error: "contracts must be a positive integer" }, { status: 400 });
    }
    patch.contracts = body.contracts;
  }
  for (const k of ["thesis", "mgmtProfit", "mgmtLoss"] as const) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "string" || !(body[k] as string).trim()) {
        return Response.json({ error: `${k} must be a non-empty string` }, { status: 400 });
      }
      patch[k] = (body[k] as string).trim();
    }
  }
  try {
    const trade = updateTrade(id, patch);
    return Response.json({ trade });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("not found")) {
      return Response.json({ error: msg }, { status: 404 });
    }
    console.error("[journal PATCH] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const { id: idStr } = await ctx.params;
  const id = parseId(idStr);
  if (id === null) return Response.json({ error: "id must be a positive integer" }, { status: 400 });
  try {
    deleteTrade(id);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("not found")) {
      return Response.json({ error: msg }, { status: 404 });
    }
    console.error("[journal DELETE] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
