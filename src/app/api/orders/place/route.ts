import type { NextRequest } from "next/server";
import { placeAndConfirm } from "../../../../lib/ibkr/orders";
import type { OrderIntent, OrderPlaceRequest } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Light validation. The order builder does the heavier checks (conid present,
// quantity > 0, etc.) at payload-assembly time, so we only enforce the shape
// callers must send and let the builder surface domain errors.
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function parseIntent(raw: unknown): OrderIntent | string {
  if (!raw || typeof raw !== "object") return "intent must be an object";
  const o = raw as Record<string, unknown>;
  if (o.kind === "open-pick" || o.kind === "roll") {
    if (!o.pick || typeof o.pick !== "object") return `${o.kind} intent requires a pick object`;
    return o as unknown as OrderIntent;
  }
  if (o.kind === "close-held") {
    if (!Array.isArray(o.legs) || o.legs.length === 0) return "close-held intent requires a legs array";
    return o as unknown as OrderIntent;
  }
  return `unknown intent.kind '${String((o as { kind?: unknown }).kind)}'`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const intent = parseIntent(body.intent);
  if (typeof intent === "string") return Response.json({ error: intent }, { status: 400 });

  if (typeof body.symbol !== "string" || !body.symbol.trim()) {
    return Response.json({ error: "symbol is required" }, { status: 400 });
  }
  if (!isFiniteNumber(body.limitPrice)) {
    return Response.json({ error: "limitPrice must be a finite number" }, { status: 400 });
  }
  if (!Number.isInteger(body.quantity) || (body.quantity as number) <= 0) {
    return Response.json({ error: "quantity must be a positive integer" }, { status: 400 });
  }
  if (body.tif !== "DAY" && body.tif !== "GTC") {
    return Response.json({ error: "tif must be 'DAY' or 'GTC'" }, { status: 400 });
  }
  if (typeof body.outsideRTH !== "boolean") {
    return Response.json({ error: "outsideRTH must be a boolean" }, { status: 400 });
  }

  const req: OrderPlaceRequest = {
    intent,
    symbol: body.symbol.trim(),
    limitPrice: body.limitPrice,
    quantity: body.quantity as number,
    tif: body.tif,
    outsideRTH: body.outsideRTH,
  };

  try {
    const result = await placeAndConfirm(req);
    return Response.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[orders/place] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
