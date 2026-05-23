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
  try {
    const rows = await runCreditSpreadScanner({ size, scanType, minPrice, minOptVolume });
    return Response.json({ rows });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[scanner] failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }
}
