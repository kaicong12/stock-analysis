import { NextResponse } from "next/server";
import { getMonthlyPnL } from "../../../../lib/journal/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");

  if (!yearParam || !monthParam) {
    return NextResponse.json(
      { error: "year and month are required" },
      { status: 400 }
    );
  }

  const year = parseInt(yearParam, 10);
  const month = parseInt(monthParam, 10);

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return NextResponse.json(
      { error: "year and month must be numbers" },
      { status: 400 }
    );
  }

  try {
    const data = getMonthlyPnL(year, month);
    // Convert array to map { [day]: pnl } for easier consumption on frontend
    const result: Record<number, number> = {};
    for (const row of data) {
      result[row.day] = row.pnl ?? 0;
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
