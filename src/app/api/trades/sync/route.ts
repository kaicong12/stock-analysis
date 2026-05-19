import { NextResponse } from "next/server";
import { syncTradesFromFlex, type SyncResult } from "../../../../lib/trades/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map sync outcomes to HTTP status so the network tab tells the truth: a sync
// that didn't actually pull data should not look like a 200. Rate-limit and
// server-cooldown both map to 429 (caller should back off), config issues to
// 400, real errors to 500. Only an actual sync or a fresh-skip is 200.
function statusFor(result: SyncResult): number {
  if (result.status === "ok") return 200;
  if (result.status === "skipped") {
    if (result.reason === "fresh") return 200;
    if (result.reason === "in_progress") return 429;
    if (result.reason === "not_configured") return 400;
    return 200;
  }
  if (result.reason === "rate_limited") return 429;
  return 500;
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1" || searchParams.get("force") === "true";
  const result = await syncTradesFromFlex({ force });
  return NextResponse.json(result, { status: statusFor(result) });
}
