import type { NextRequest } from "next/server";
import { getScreener } from "../../../lib/moomoo/sidecar";
import { SCREENER_DEFAULTS } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Stage 2/3 walk the survivors one at a time through OpenD's single-context
// lock plus a yfinance calendar read each, so a cold run is slow by design.
export const maxDuration = 300;

function intParam(request: NextRequest, key: string, fallback: number): number {
  const raw = request.nextUrl.searchParams.get(key);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: NextRequest) {
  const dteMin = intParam(request, "dteMin", SCREENER_DEFAULTS.dteMin);
  const dteMax = intParam(request, "dteMax", SCREENER_DEFAULTS.dteMax);
  const limit = intParam(request, "limit", SCREENER_DEFAULTS.limit);

  if (dteMin > dteMax) {
    return Response.json({ error: "dteMin must not exceed dteMax" }, { status: 400 });
  }

  try {
    return Response.json(await getScreener(dteMin, dteMax, limit));
  } catch (e) {
    return Response.json(
      { error: "screener unavailable", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
