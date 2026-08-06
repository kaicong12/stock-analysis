import type { NextRequest } from "next/server";
import { getScreenerFunnel } from "../../../../lib/moomoo/sidecar";
import { SCREENER_DEFAULTS } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One throttled OpenD screen call per gate, ~11 gates at a 3.5s floor.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const dteMin = Number.parseInt(sp.get("dteMin") ?? "", 10);
  const dteMax = Number.parseInt(sp.get("dteMax") ?? "", 10);

  try {
    return Response.json(
      await getScreenerFunnel(
        Number.isFinite(dteMin) ? dteMin : SCREENER_DEFAULTS.dteMin,
        Number.isFinite(dteMax) ? dteMax : SCREENER_DEFAULTS.dteMax,
      ),
    );
  } catch (e) {
    return Response.json(
      { error: "funnel unavailable", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
