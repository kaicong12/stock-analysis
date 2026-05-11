import type { NextRequest } from "next/server";
import { closeTrade, getTrade } from "../../../../../lib/journal/db";
import type { CloseTradeInput } from "../../../../../lib/journal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id must be a positive integer" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.realizedPnl !== "number" || !Number.isFinite(body.realizedPnl)) {
    return Response.json({ error: "realizedPnl is required (signed total $)" }, { status: 400 });
  }
  if (typeof body.exitReason !== "string" || !body.exitReason.trim()) {
    return Response.json({ error: "exitReason is required" }, { status: 400 });
  }
  let closedAt: string | undefined;
  if (body.closedAt !== undefined) {
    if (typeof body.closedAt !== "string" || Number.isNaN(Date.parse(body.closedAt))) {
      return Response.json({ error: "closedAt must be a valid ISO timestamp" }, { status: 400 });
    }
    closedAt = body.closedAt;
  }
  let ibkrCloseOrderId: string | null = null;
  if (body.ibkrCloseOrderId !== undefined && body.ibkrCloseOrderId !== null) {
    if (typeof body.ibkrCloseOrderId !== "string" || !body.ibkrCloseOrderId.trim()) {
      return Response.json({ error: "ibkrCloseOrderId must be a non-empty string when provided" }, { status: 400 });
    }
    ibkrCloseOrderId = body.ibkrCloseOrderId.trim();
  }

  // Idempotency check before mutating: 409 with existing data if already closed.
  const existing = getTrade(id);
  if (!existing) return Response.json({ error: "trade not found" }, { status: 404 });
  if (existing.status === "closed") {
    return Response.json({ error: "trade already closed", trade: existing }, { status: 409 });
  }

  const input: CloseTradeInput = {
    realizedPnl: body.realizedPnl,
    exitReason: body.exitReason.trim(),
    closedAt,
    ibkrCloseOrderId,
  };

  try {
    const trade = closeTrade(id, input);
    return Response.json({ trade });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("not found") || msg.includes("already closed")) {
      // Race: re-fetch and return whichever applies.
      const after = getTrade(id);
      const status = !after ? 404 : 409;
      return Response.json({ error: msg, trade: after }, { status });
    }
    console.error("[journal close] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
