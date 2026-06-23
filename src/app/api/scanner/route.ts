import type { NextRequest } from "next/server";
import {
  runCreditSpreadScanner,
  VALID_SCAN_TYPES,
  type ScanType,
} from "../../../lib/ibkr/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ScannerBody {
  size?: number;
  scanType?: string;
  minPrice?: number;
  minOptVolume?: number;
  minIvPercentile?: number;
  minIvRank?: number;
}

// Both IV gates are 0-100 percentages in the API. null disables a gate; we keep
// them enabled by default at 50 (matches the CLAUDE.md "IVR > 50" baseline).
function clampPct(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export async function POST(request: NextRequest) {
  let body: ScannerBody = {};
  try {
    body = (await request.json()) as ScannerBody;
  } catch {
    // Empty body falls back to defaults.
  }
  const size = Math.max(10, Math.min(100, Number(body.size) || 50));
  const rawScanType = body.scanType ?? VALID_SCAN_TYPES[0];
  const scanType: ScanType = (VALID_SCAN_TYPES as readonly string[]).includes(rawScanType)
    ? (rawScanType as ScanType)
    : VALID_SCAN_TYPES[0];
  const minPrice = Math.max(20, Number(body.minPrice) || 20);
  const minOptVolume = Math.max(500, Number(body.minOptVolume) || 1_000);
  const minIvPercentile = clampPct(body.minIvPercentile, 50);
  const minIvRank = clampPct(body.minIvRank, 50);
  try {
    const rows = await runCreditSpreadScanner({
      size,
      scanType,
      minPrice,
      minOptVolume,
      minIvPercentile,
      minIvRank,
    });
    return Response.json({ rows });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[scanner] failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }
}
