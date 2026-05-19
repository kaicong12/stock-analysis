import https from "node:https";
import { URL } from "node:url";
import { env } from "../env";

const FLEX_BASE =
  "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService";

export interface FlexTrade {
  transactionId: string;
  accountId: string;
  tradeDate: string;            // YYYY-MM-DD (normalized from YYYYMMDD)
  assetCategory: string;        // STK | OPT | CASH | ...
  symbol: string;
  description: string | null;
  conid: number | null;
  strike: number | null;
  expiry: string | null;        // YYYY-MM-DD
  putCall: "C" | "P" | null;
  multiplier: number | null;
  transactionType: string;
  buySell: string;              // BUY | SELL
  quantity: number;
  tradePrice: number | null;
  proceeds: number | null;
  ibCommission: number | null;
  netCash: number | null;
  openClose: "O" | "C" | null;
  fifoPnlRealized: number;
  mtmPnl: number | null;
  currency: string;
  ibOrderId: string | null;
  orderTime: string | null;     // raw "YYYYMMDD;HHMMSS"
  raw: string;                  // full `<Trade .../>` tag for forensics
}

export interface FlexFetchResult {
  trades: FlexTrade[];
  fromDate: string;             // YYYY-MM-DD
  toDate: string;
  whenGenerated: string;        // raw "YYYYMMDD;HHMMSS"
}

export interface FlexErrorWithCode extends Error {
  code?: string;
  transient?: boolean;
}

// IBKR rate-limits the Flex Web Service (same query can typically only be
// re-requested every few minutes). The service signals this with a non-Success
// status whose message asks us to "try again shortly". We treat anything that
// looks like that as transient.
function isTransientFlexMessage(msg: string | null): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("try again shortly") ||
    m.includes("could not be generated at this time") ||
    m.includes("generation in progress")
  );
}

function httpGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https
      .request(
        {
          method: "GET",
          host: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          headers: { "User-Agent": "stock-analysis/0.1" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (!res.statusCode || res.statusCode >= 400) {
              reject(new Error(`Flex HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
              return;
            }
            resolve(text);
          });
        }
      )
      .on("error", reject)
      .end();
  });
}

function pickTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

// SendRequest → ReferenceCode. Throws with `.code` set when IBKR returns an
// error envelope (e.g. bad token, query not found) so the caller can stamp
// last_error meaningfully. Transient errors (per-query cooldown) are tagged
// `.transient = true` so the sync layer can downgrade them to a soft skip
// rather than a hard 500. We deliberately do NOT retry in-process — IBKR's
// cooldown is minutes-long, and the sync layer's attempt-level dedupe already
// prevents the next /sync call from hammering the service.
async function sendRequest(token: string, queryId: string): Promise<string> {
  const url = `${FLEX_BASE}.SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`;
  const body = await httpGetText(url);
  const status = pickTag(body, "Status");
  if (status === "Success") {
    const ref = pickTag(body, "ReferenceCode");
    if (!ref) throw new Error("Flex SendRequest: missing ReferenceCode");
    return ref;
  }
  const msg = pickTag(body, "ErrorMessage") ?? body.slice(0, 200);
  const err: FlexErrorWithCode = new Error(`Flex SendRequest failed: ${msg}`);
  err.code = pickTag(body, "ErrorCode") ?? undefined;
  err.transient = isTransientFlexMessage(msg);
  throw err;
}

// Statement generation is async on IBKR's side. While it's still building, the
// service returns a small envelope with ErrorCode=1019 ("in progress"). We
// retry on that specifically; other ErrorCodes propagate immediately because
// they typically indicate a permanent issue (bad reference, expired token).
const POLL_DELAYS_MS = [2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000];

async function pollStatement(token: string, referenceCode: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const url = `${FLEX_BASE}.GetStatement?t=${encodeURIComponent(token)}&q=${encodeURIComponent(referenceCode)}&v=3`;
    const body = await httpGetText(url);
    if (body.includes("<FlexQueryResponse")) return body;
    const code = pickTag(body, "ErrorCode");
    const msg = pickTag(body, "ErrorMessage") ?? body.slice(0, 200);
    if (code !== "1019") {
      const err: FlexErrorWithCode = new Error(`Flex GetStatement failed: ${msg}`);
      err.code = code ?? undefined;
      throw err;
    }
    if (attempt >= POLL_DELAYS_MS.length) {
      throw new Error(`Flex GetStatement: report not ready after ${POLL_DELAYS_MS.length + 1} attempts`);
    }
    await new Promise((r) => setTimeout(r, POLL_DELAYS_MS[attempt]));
  }
}

function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseTradeTag(raw: string): FlexTrade | null {
  // Each attribute is `name="value"`; Flex never embeds quotes inside values.
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  for (let m: RegExpExecArray | null; (m = re.exec(raw)); ) attrs[m[1]] = m[2];

  const transactionId = attrs.transactionID;
  const accountId = attrs.accountId;
  const tradeDate = normalizeDate(attrs.tradeDate);
  const assetCategory = attrs.assetCategory;
  const symbol = attrs.symbol;
  const buySell = attrs.buySell;
  const transactionType = attrs.transactionType;
  const quantityNum = num(attrs.quantity);
  const currency = attrs.currency;

  // Skip rows missing identity fields rather than poisoning the DB. AssetSummary
  // rows from the same XML look like Trades but have empty symbol/transactionID
  // and would fail the NOT NULL constraints anyway.
  if (
    !transactionId ||
    !accountId ||
    !tradeDate ||
    !assetCategory ||
    !symbol ||
    !buySell ||
    !transactionType ||
    quantityNum === null ||
    !currency
  ) {
    return null;
  }

  const putCallRaw = attrs.putCall;
  const openCloseRaw = attrs.openCloseIndicator;
  return {
    transactionId,
    accountId,
    tradeDate,
    assetCategory,
    symbol,
    description: attrs.description || null,
    conid: num(attrs.conid),
    strike: num(attrs.strike),
    expiry: normalizeDate(attrs.expiry),
    putCall: putCallRaw === "C" || putCallRaw === "P" ? putCallRaw : null,
    multiplier: num(attrs.multiplier),
    transactionType,
    buySell,
    quantity: quantityNum,
    tradePrice: num(attrs.tradePrice),
    proceeds: num(attrs.proceeds),
    ibCommission: num(attrs.ibCommission),
    netCash: num(attrs.netCash),
    openClose: openCloseRaw === "O" || openCloseRaw === "C" ? openCloseRaw : null,
    fifoPnlRealized: num(attrs.fifoPnlRealized) ?? 0,
    mtmPnl: num(attrs.mtmPnl),
    currency,
    ibOrderId: attrs.ibOrderID || null,
    orderTime: attrs.orderTime || null,
    raw,
  };
}

function parseStatement(xml: string): FlexFetchResult {
  const stmtAttrsMatch = /<FlexStatement ([^>]+)>/.exec(xml);
  if (!stmtAttrsMatch) throw new Error("Flex response missing <FlexStatement>");
  const stmtAttrs: Record<string, string> = {};
  for (const [, k, v] of stmtAttrsMatch[1].matchAll(/(\w+)="([^"]*)"/g)) stmtAttrs[k] = v;

  const fromDate = normalizeDate(stmtAttrs.fromDate);
  const toDate = normalizeDate(stmtAttrs.toDate);
  if (!fromDate || !toDate) throw new Error("Flex response missing fromDate/toDate");

  const trades: FlexTrade[] = [];
  // Self-closing `<Trade ... />`. AssetSummary uses the same shape but parseTradeTag
  // drops it via the identity-fields guard.
  for (const m of xml.matchAll(/<Trade ([^/]+)\/>/g)) {
    const t = parseTradeTag(m[0]);
    if (t) trades.push(t);
  }

  return { trades, fromDate, toDate, whenGenerated: stmtAttrs.whenGenerated ?? "" };
}

export async function fetchFlexTrades(): Promise<FlexFetchResult> {
  if (!env.ibkrFlexToken || !env.ibkrFlexQueryId) {
    throw new Error(
      "Flex Web Service not configured: set IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID in .env"
    );
  }
  const ref = await sendRequest(env.ibkrFlexToken, env.ibkrFlexQueryId);
  const xml = await pollStatement(env.ibkrFlexToken, ref);
  return parseStatement(xml);
}
