import type { NextRequest } from "next/server";
import { runCreditSpreadScanner } from "../../../lib/ibkr/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ScannerBody {
  size?: number;
}

export async function POST(request: NextRequest) {
  let body: ScannerBody = {};
  try {
    body = (await request.json()) as ScannerBody;
  } catch {
    // Empty body falls back to defaults.
  }
  const size = Math.max(10, Math.min(100, Number(body.size) || 50));
  try {
    const rows = await runCreditSpreadScanner(size);
    return Response.json({ rows });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[scanner] failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }
}
