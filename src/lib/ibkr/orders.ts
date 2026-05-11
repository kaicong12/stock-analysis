import { ibkr, placeOrder, replyOrder, resolveAccountId, ensureIserverBridge } from "./client";
import { getUnderlying } from "./secdef-store";
import { searchUnderlying } from "./options";
import type {
  ContractLeg,
  ContractPick,
  OrderIntent,
  OrderLeg,
  OrderPlaceRequest,
  OrderPlaceResponse,
  OrderStatus,
} from "../types";

// ---- Intent → flat OrderLeg list -------------------------------------------

// Resolve a ContractPick into the legs we send to IBKR. The picker has already
// resolved each leg's conid via the option chain fetch; we just need the
// signed BUY/SELL ratio.
function legsFromPick(pick: ContractPick, intent: "open-pick" | "roll"): OrderLeg[] {
  const out: OrderLeg[] = [];
  const push = (leg: ContractLeg | undefined, ratio: 1 | -1) => {
    if (!leg) return;
    if (!leg.conid) throw new Error(`order builder: leg ${leg.description} has no conid`);
    out.push({
      conid: leg.conid,
      side: leg.side,
      strike: leg.strike,
      expiry: leg.expiry,
      ratio,
      lastPrice: leg.last ?? null,
    });
  };

  if (intent === "roll") {
    const rp = pick.rollPlan;
    if (!rp) throw new Error("order builder: roll intent requires pick.rollPlan");
    // Closing existing legs: invert each held leg's open side. A short put we
    // sold to open closes with BUY_TO_CLOSE (ratio +1); a long call we bought
    // closes with SELL_TO_CLOSE (ratio -1). The picker stores closing legs
    // with `ratio` already populated as the held position's sign — so to
    // *close* we send the opposite sign.
    for (const leg of rp.closingLegs) {
      const heldRatio: 1 | -1 = (leg.ratio ?? 1) >= 0 ? 1 : -1;
      const closeRatio: 1 | -1 = heldRatio === 1 ? -1 : 1;
      push(leg, closeRatio);
    }
    for (const leg of rp.openingLegs) {
      const r: 1 | -1 = (leg.ratio ?? 1) >= 0 ? 1 : -1;
      push(leg, r);
    }
    return out;
  }

  // open-pick: cover every geometry the picker emits.
  if (pick.longLeg) push(pick.longLeg, 1);
  if (pick.shortLeg) push(pick.shortLeg, -1);
  if (pick.longPutLeg) push(pick.longPutLeg, 1);
  if (pick.shortPutLeg) push(pick.shortPutLeg, -1);
  if (pick.shortCallLeg) push(pick.shortCallLeg, -1);
  if (pick.longCallLeg) push(pick.longCallLeg, 1);
  return out;
}

export function legsFromIntent(intent: OrderIntent): OrderLeg[] {
  if (intent.kind === "open-pick") return legsFromPick(intent.pick, "open-pick");
  if (intent.kind === "roll") return legsFromPick(intent.pick, "roll");
  return intent.legs;
}

// ---- Underlying conid resolution -------------------------------------------

// IBKR combo orders need the underlying conid for the `conidex` prefix and the
// `secType: "<undConid>:BAG"` field. Try the local secdef cache first; fall
// back to a live secdef/search via ensureUnderlying().
// Strip any moomoo-style market prefix ("US.NVDA" → "NVDA", "HK.00700" →
// "00700"). IBKR's /iserver/secdef/search expects the bare ticker; callers
// occasionally pass the prefixed form because elsewhere in the app `symbol`
// historically means the moomoo-prefixed name.
function bareTicker(s: string): string {
  const dot = s.indexOf(".");
  return dot > 0 ? s.slice(dot + 1) : s;
}

async function resolveUnderlyingConid(symbol: string): Promise<number> {
  const bare = bareTicker(symbol).toUpperCase();
  const cached = getUnderlying(bare);
  if (cached?.conid) return cached.conid;
  // Close-position flow can hit this when the user never ran the picker for
  // this underlying in the current session (and the secdef cache is empty).
  // searchUnderlying calls /iserver/secdef/search directly and populates the
  // cache as a side-effect — no spot price required.
  const fetched = await searchUnderlying(bare);
  if (!fetched?.conid) throw new Error(`order builder: could not resolve underlying conid for ${bare}`);
  return fetched.conid;
}

// ---- Payload assembly ------------------------------------------------------

interface BuiltOrder {
  conid?: number;
  conidex?: string;
  secType?: string;
  orderType: "LMT";
  side: "BUY" | "SELL";
  price: number;
  tif: "DAY" | "GTC";
  outsideRTH: boolean;
  quantity: number;
  acctId?: string;
  cOID?: string;
}

// IBKR conventions on price sign for combos: a positive `price` always means
// "willing to pay this much" (debit). A negative `price` means "willing to
// receive at least this much" (credit). The side field is BUY for the package
// — IBKR derives leg-level buys/sells from the conidex ratios.
//
// For a single-leg order, we send a positive `price` and an explicit
// BUY/SELL side. The user-entered `limitPrice` in OrderPlaceRequest is signed
// the same way as the picker emits it: positive = debit-to-open, negative =
// credit-to-receive. We translate that to IBKR's convention at the boundary.
export async function buildPlacePayload(
  req: OrderPlaceRequest,
): Promise<{ orders: BuiltOrder[] }> {
  const legs = legsFromIntent(req.intent);
  if (!legs.length) throw new Error("order builder: no legs in intent");
  if (req.quantity <= 0) throw new Error("order builder: quantity must be > 0");

  // Round to 2dp — IBKR rejects sub-penny prices for most US options.
  const px = Math.round(req.limitPrice * 100) / 100;

  if (legs.length === 1) {
    const leg = legs[0];
    const side: "BUY" | "SELL" = leg.ratio === 1 ? "BUY" : "SELL";
    return {
      orders: [
        {
          conid: leg.conid,
          secType: `${leg.conid}:OPT`,
          orderType: "LMT",
          side,
          price: Math.abs(px),
          tif: req.tif,
          outsideRTH: req.outsideRTH,
          quantity: req.quantity,
        },
      ],
    };
  }

  // Multi-leg combo. underConid prefixes conidex and tags secType.
  const underConid = await resolveUnderlyingConid(req.symbol);
  // conidex: "<underConid>;;;<leg1Conid>/<ratio1>,<leg2Conid>/<ratio2>,..."
  const conidex =
    `${underConid};;;` +
    legs.map((l) => `${l.conid}/${l.ratio}`).join(",");

  return {
    orders: [
      {
        conidex,
        secType: `${underConid}:BAG`,
        orderType: "LMT",
        // IBKR ignores BUY/SELL on combos when conidex carries signs, but it
        // is a required field — convention is BUY for combos.
        side: "BUY",
        price: px,
        tif: req.tif,
        outsideRTH: req.outsideRTH,
        quantity: req.quantity,
      },
    ],
  };
}

// ---- Reply-warning chain ---------------------------------------------------

interface IbkrOrderReplyRow {
  id?: string;            // present on confirmation prompts
  message?: string[];     // warning text
  isSuppressed?: boolean;
  messageIds?: string[];
  order_id?: string;      // present on the final accepted row
  order_status?: string;
  encrypt_message?: string;
}

// IBKR returns an array of rows. A row with `id` + `message` is a confirmation
// prompt that requires POST /iserver/reply/{id}. The final accepted row has
// `order_id` + `order_status`. We auto-confirm every warning until we either
// hit the terminal row or run out of patience.
async function walkReplies(
  initial: IbkrOrderReplyRow[],
): Promise<{ orderId: string; status: string; warnings: string[] }> {
  let rows = initial;
  const warnings: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (!rows?.length) throw new Error("IBKR order: empty reply chain");
    const accepted = rows.find((r) => r.order_id);
    if (accepted) {
      return {
        orderId: String(accepted.order_id),
        status: accepted.order_status ?? "Submitted",
        warnings,
      };
    }
    // First row that needs confirmation.
    const prompt = rows.find((r) => r.id && Array.isArray(r.message));
    if (!prompt) {
      // No prompt and no acceptance — surface raw payload to aid debugging.
      throw new Error(`IBKR order: unexpected reply shape ${JSON.stringify(rows).slice(0, 400)}`);
    }
    warnings.push(...(prompt.message ?? []));
    rows = (await replyOrder(prompt.id!, true)) as IbkrOrderReplyRow[];
  }
  throw new Error("IBKR order: too many reply confirmations (>8); aborting");
}

// ---- Public entry points ---------------------------------------------------

export async function placeAndConfirm(req: OrderPlaceRequest): Promise<OrderPlaceResponse> {
  await ensureIserverBridge();
  const accountId = await resolveAccountId();
  const payload = await buildPlacePayload(req);
  const first = (await placeOrder(accountId, payload)) as IbkrOrderReplyRow[];
  return walkReplies(first);
}

interface IbkrOrderStatusResp {
  order_id?: number | string;
  order_status?: string;
  status?: string;
  avg_price?: string | number;
  avgPrice?: string | number;
  filled_quantity?: number;
  total_size?: number;
  size?: number;
}

export async function getOrderStatus(orderId: string): Promise<OrderStatus> {
  await ensureIserverBridge();
  const r = await ibkr<IbkrOrderStatusResp>(`/iserver/account/order/status/${orderId}`);
  const avgRaw = r.avg_price ?? r.avgPrice;
  const avg = typeof avgRaw === "string" ? Number(avgRaw) : avgRaw;
  return {
    orderId,
    status: r.order_status ?? r.status ?? "Unknown",
    avgFillPrice: Number.isFinite(avg) ? Number(avg) : null,
    filledQuantity: Number(r.filled_quantity ?? 0),
    totalQuantity: Number(r.total_size ?? r.size ?? 0),
  };
}
