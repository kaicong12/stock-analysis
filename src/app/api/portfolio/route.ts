import { getPortfolio } from "../../../lib/ibkr/client";
import { enrichOptionExpiries } from "../../../lib/positions/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const portfolio = await getPortfolio();
    // Mirror /api/prep: resolve weekly OPT maturities so the client-side
    // classifyPortfolio sees real expiries, not the third-Friday fallback.
    const positions = await enrichOptionExpiries(portfolio.positions);
    return Response.json({ ...portfolio, positions });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
