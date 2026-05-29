import type { NextRequest } from "next/server";
import { pickContract, pickerEligible } from "../../../lib/gemini/contract-picker";
import { getNarrowOptionChain, type NarrowChainOptions } from "../../../lib/moomoo/options";
import type {
  HeldGroup,
  Portfolio,
  Position,
  SnapshotResult,
  Verdict,
} from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PickBody {
  ticker?: string;
  symbol?: string;
  snapshot?: SnapshotResult | null;
  portfolio?: Portfolio | null;
  heldPositions?: Position[];
  heldGroups?: HeldGroup[];
  verdict?: Verdict | null;
  // Forwarded from data.fundamentals.data.nextEarningsDate so the picker
  // can apply earnings-aware expiry rules. Null when yfinance has no
  // listed earnings date or it has already passed.
  nextEarningsDate?: string | null;
}

function earningsDaysAwayFromISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((target - Date.now()) / 86_400_000);
}

// Widen the strike window asymmetrically toward the side the strategy cares about.
// Keeps the irrelevant side narrow to avoid blowing the snapshot conid budget.
function chainWindowForAction(
  action: string,
  rollHint?: "OUT" | "OUT_AND_DOWN" | "OUT_AND_UP",
): Pick<NarrowChainOptions, "lowerPctWindow" | "upperPctWindow"> {
  switch (action) {
    case "SELL_PUT_SPREAD":
    case "SELL_CASH_SECURED_PUT":
    case "BUY_PUT_SPREAD":
      return { lowerPctWindow: 0.25, upperPctWindow: 0.08 };
    case "SELL_CALL_SPREAD":
    case "SELL_COVERED_CALL":
    case "BUY_CALL_SPREAD":
      return { lowerPctWindow: 0.08, upperPctWindow: 0.25 };
    case "IRON_CONDOR":
      return { lowerPctWindow: 0.20, upperPctWindow: 0.20 };
    case "ROLL_OUT":
      if (rollHint === "OUT_AND_DOWN") return { lowerPctWindow: 0.30, upperPctWindow: 0.08 };
      if (rollHint === "OUT_AND_UP") return { lowerPctWindow: 0.08, upperPctWindow: 0.30 };
      return { lowerPctWindow: 0.20, upperPctWindow: 0.20 };
    default:
      return { lowerPctWindow: 0.15, upperPctWindow: 0.15 };
  }
}

// Map a held group's rule-based suggestion onto the picker's rollHint enum.
function rollHintFromSuggestion(
  groups: HeldGroup[] | undefined,
  ticker: string,
): "OUT" | "OUT_AND_DOWN" | "OUT_AND_UP" | undefined {
  if (!groups?.length) return undefined;
  const tk = ticker.toUpperCase();
  // Pick the first matching held group on this ticker that has a roll suggestion.
  // Real users rarely have multiple defensive-roll candidates on the same name
  // at the same time; if they do, the first one wins (UI surfaces them all).
  for (const g of groups) {
    if (g.underlying !== tk) continue;
    if (g.suggestion === "ROLL_OUT_AND_DOWN") return "OUT_AND_DOWN";
    if (g.suggestion === "ROLL_OUT_AND_UP") return "OUT_AND_UP";
    if (g.suggestion === "ROLL_OUT") return "OUT";
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  let body: PickBody;
  try {
    body = (await request.json()) as PickBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.ticker || !body.symbol || !body.verdict) {
    return Response.json({ error: "ticker, symbol, and verdict are required" }, { status: 400 });
  }
  if (!pickerEligible(body.verdict.derivatives.action)) {
    return Response.json({ pick: null });
  }

  try {
    const spot = body.snapshot?.lastPrice ?? 0;
    const rollHint = rollHintFromSuggestion(body.heldGroups, body.ticker);
    const chainWindow = chainWindowForAction(body.verdict.derivatives.action, rollHint);
    const chain = await getNarrowOptionChain(body.symbol, spot, chainWindow);
    if (!chain.expiries.length) {
      throw new Error(
        `No option chain available for ${body.symbol} — moomoo returned no expiries in the 20-60 DTE window. ` +
        `The underlying may have no listed options or no contracts in-window on a major US exchange.`
      );
    }
    const nextEarningsDate = body.nextEarningsDate ?? null;
    const earningsDaysAway = earningsDaysAwayFromISO(nextEarningsDate);
    const pick = await pickContract({
      ticker: body.ticker,
      symbol: body.symbol,
      spot: chain.spot,
      derivativesAction: body.verdict.derivatives.action,
      direction: body.verdict.derivatives.direction,
      confidence: body.verdict.confidence,
      chain,
      portfolio: body.portfolio ?? null,
      heldPositions: body.heldPositions ?? [],
      rollHint,
      nextEarningsDate,
      earningsDaysAway,
    });
    return Response.json({ pick });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[contract-pick] failed:`, msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
