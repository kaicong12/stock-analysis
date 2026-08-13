import { fetchMarketDigest } from "@/lib/digest/run";

// Market-wide daily digest. Sourcing plus six LLM calls, two chained behind the scout.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const digest = await fetchMarketDigest();
    if (!digest.sections.some((s) => s.status === "ready")) {
      return Response.json(
        { error: "Market digest unavailable — every section failed.", digest },
        { status: 503 },
      );
    }
    return Response.json({ digest });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
