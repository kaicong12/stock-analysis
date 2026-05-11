import type { NextRequest } from "next/server";
import { getOrderStatus } from "../../../../lib/ibkr/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) return Response.json({ error: "orderId is required" }, { status: 400 });
  try {
    const status = await getOrderStatus(orderId);
    return Response.json(status);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[orders/status] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
