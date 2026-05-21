import { NextResponse } from "next/server";
import {
  getMonthlyPnL,
  getSyncStatus,
  type AssetClassFilter,
} from "../../../../lib/trades/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_FILTERS: AssetClassFilter[] = ["STK", "OPT", "CASH", "all"];

function parseAssetClass(raw: string | null): AssetClassFilter {
  if (!raw) return "all";
  return (VALID_FILTERS as string[]).includes(raw) ? (raw as AssetClassFilter) : "all";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");

  if (!yearParam || !monthParam) {
    return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  }
  const year = parseInt(yearParam, 10);
  const month = parseInt(monthParam, 10);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "year and month must be valid numbers (month 1-12)" },
      { status: 400 }
    );
  }

  const assetClass = parseAssetClass(searchParams.get("assetClass"));

  try {
    const rows = getMonthlyPnL(year, month, assetClass);
    const data: Record<number, number> = {};
    const baseData: Record<number, number> = {};
    for (const r of rows) {
      data[r.day] = r.pnl;
      baseData[r.day] = r.basePnl;
    }
    return NextResponse.json({ data, baseData, sync: getSyncStatus(), assetClass });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
