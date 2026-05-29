import https from "node:https";
import { URL } from "node:url";
import { env } from "../env";
import type {
  Currency,
  LedgerEntry,
  Portfolio,
  PortfolioSummary,
  Position,
} from "../types";

const insecureAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

interface IbkrErrorWithStatus extends Error {
  status?: number;
}

// Single round-trip. Resolves with parsed JSON, rejects with an Error that
// carries the HTTP status as `.status` so callers (the retry wrapper) can
// distinguish 429 from other failures.
function ibkrOnce<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  const url = new URL(`${env.ibkrBaseUrl}/v1/api${path}`);
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        method: init?.method ?? "GET",
        host: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        agent: insecureAgent,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "stock-analysis/0.1",
          ...(init?.body ? { "Content-Length": Buffer.byteLength(init.body).toString() } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            const err: IbkrErrorWithStatus = new Error(`IBKR ${path} ${res.statusCode}: ${text.slice(0, 300)}`);
            err.status = res.statusCode;
            reject(err);
            return;
          }
          try {
            resolve(text ? (JSON.parse(text) as T) : (undefined as T));
          } catch (e) {
            reject(new Error(`IBKR ${path}: invalid JSON: ${(e as Error).message}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
}

// IBKR Client Portal Gateway throttles /iserver/secdef/* aggressively; the
// burst pattern from a chain fan-out (~30+ secdef/info calls) commonly hits
// 429. Retry with exponential backoff handles the transient case. Non-429
// failures bubble immediately — auth issues and "no bridge" don't get better
// by waiting.
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export async function ibkr<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ibkrOnce<T>(path, init);
    } catch (e) {
      const err = e as IbkrErrorWithStatus;
      // "no bridge" means the iserver session lost its bootstrap (gateway
      // restart, sleep, or upstream flake). Invalidate the cached bridged
      // flag so the next ensureIserverBridge() actually re-attempts
      // /iserver/accounts; rethrow without retrying — the user typically
      // also needs to re-authenticate at the gateway browser URL before
      // re-bridging succeeds, and silent retries here would mask that.
      if (typeof err.message === "string" && err.message.toLowerCase().includes("no bridge")) {
        iserverBridged = false;
        throw err;
      }
      if (err.status !== 429 || attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

interface RawAccountRow {
  id?: string;
  accountId?: string;
  type?: string;        // "DEMO" / "INDIVIDUAL" / "JOINT" / "ORG" / etc.
  tradingType?: string; // "STKNOPT" etc.
}

interface ResolvedAccount {
  accountId: string;
  accountType: string;
  isPaper: boolean;
}

// Resolves the active IBKR account by asking /portfolio/accounts. IBKR
// sometimes returns multiple account ids per login (e.g. a newly-opened but
// unfunded sibling account alongside the active one). Picking by list order
// would silently land on the empty account, so we probe each candidate's
// summary and pick the one with the highest netLiquidation. Cached per
// process; restart the server if you switch logged-in accounts in the gateway.
let cachedAccount: ResolvedAccount | null = null;
export async function resolveAccount(): Promise<ResolvedAccount> {
  if (cachedAccount) return cachedAccount;
  const rows = await ibkr<RawAccountRow[]>("/portfolio/accounts");
  const candidates = (rows ?? [])
    .map((r) => ({ ...r, accountId: r.accountId ?? r.id }))
    .filter((r): r is RawAccountRow & { accountId: string } => !!r.accountId);
  if (!candidates.length) throw new Error("IBKR /portfolio/accounts returned no usable account id");

  let picked: typeof candidates[number] = candidates[0];
  if (candidates.length > 1) {
    const ranked = await Promise.all(
      candidates.map(async (c) => {
        try {
          const s = await ibkr<RawSummary>(`/portfolio/${c.accountId}/summary`);
          return { c, nlv: s.netliquidation?.amount ?? 0 };
        } catch {
          return { c, nlv: 0 };
        }
      })
    );
    ranked.sort((a, b) => b.nlv - a.nlv);
    picked = ranked[0].c;
  }

  const accountType = picked.type ?? "UNKNOWN";
  cachedAccount = {
    accountId: picked.accountId,
    accountType,
    isPaper: accountType === "DEMO",
  };
  return cachedAccount;
}

export async function resolveAccountId(): Promise<string> {
  return (await resolveAccount()).accountId;
}

export async function preflight(): Promise<void> {
  await resolveAccountId();
}

// Some /iserver/* endpoints (secdef/*, marketdata/*) return "no bridge" until
// the iserver session is bootstrapped. /iserver/accounts is the documented
// idempotent way to do that. We cache success per process, but the ibkr()
// wrapper auto-invalidates this flag if any call subsequently returns
// "no bridge" (gateway restart, sleep, or upstream flake) so the next
// ensureIserverBridge() actually re-attempts the bootstrap.
let iserverBridged = false;
export async function ensureIserverBridge(): Promise<void> {
  if (iserverBridged) return;
  await ibkr<unknown>("/iserver/accounts");
  iserverBridged = true;
}

export async function tickle(): Promise<unknown> {
  return ibkr<unknown>("/tickle");
}

interface RawPosition {
  acctId: string;
  conid: number;
  contractDesc: string;
  position: number;
  avgCost: number;
  avgPrice: number;
  mktPrice: number;
  mktValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  currency: string;
  assetClass: string;
  expiry?: string | null;
  strike?: number | null;
  putOrCall?: string | null;
  multiplier?: string | null;
  undConid?: number;
  underlyingConid?: number;
}

// IBKR's /portfolio/{accountId}/positions/{page} endpoint inconsistently
// populates strike / expiry / putOrCall on OPT rows — sometimes 0/null even
// when the contractDesc has them. Parse the desc as a fallback so the
// HeldGroup classifier and the synth prompt see well-formed data.
const MONTH_TO_NUM: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// Third Friday of the given month — standard US monthly equity-options expiry.
function thirdFridayIso(year: number, month1to12: number): string {
  const firstOfMonth = new Date(Date.UTC(year, month1to12 - 1, 1));
  const firstDow = firstOfMonth.getUTCDay(); // 0=Sun..6=Sat, Friday=5
  const firstFriday = ((5 - firstDow + 7) % 7) + 1;
  const day = firstFriday + 14;
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface OptionDescParts {
  strike: number | null;
  expiry: string | null;       // ISO YYYY-MM-DD (third Friday for monthlies)
  putOrCall: "C" | "P" | null;
}

// IBKR's portfolio endpoint returns expiry in mixed formats — sometimes
// dashed ISO, sometimes "YYYYMMDD". Downstream bucket keys do raw string
// equality, so two legs that name the same date in different formats split
// into different groups. Normalize at the adapter boundary.
function normalizeExpiry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Parse a contractDesc like "AAPL JUN2026 260 P" → { strike: 260, expiry: "2026-06-19", putOrCall: "P" }.
function parseOptionDesc(desc: string): OptionDescParts {
  const parts = desc.trim().split(/\s+/);
  if (parts.length < 4) return { strike: null, expiry: null, putOrCall: null };
  const monthYear = parts[1]; // e.g. "JUN2026"
  const strikeStr = parts[2]; // e.g. "260" or "260.5"
  const right = parts[3];     // "C" or "P"

  const m = /^([A-Z]{3})(\d{4})$/.exec(monthYear);
  let expiry: string | null = null;
  if (m) {
    const month = MONTH_TO_NUM[m[1]];
    const year = Number(m[2]);
    if (month && Number.isFinite(year)) {
      expiry = thirdFridayIso(year, Number(month));
    }
  }

  const strike = Number(strikeStr);
  const putOrCall: "C" | "P" | null = right === "C" || right === "P" ? right : null;

  return {
    strike: Number.isFinite(strike) && strike > 0 ? strike : null,
    expiry,
    putOrCall,
  };
}

function adaptPosition(p: RawPosition): Position {
  // For OPT, derive strike / expiry / putOrCall from contractDesc when the
  // IBKR fields are missing or zero. Stocks bypass this entirely.
  const fb: OptionDescParts = p.assetClass === "OPT"
    ? parseOptionDesc(p.contractDesc)
    : { strike: null, expiry: null, putOrCall: null };

  return {
    acctId: p.acctId,
    conid: p.conid,
    contractDesc: p.contractDesc,
    position: p.position,
    avgCost: p.avgCost,
    avgPrice: p.avgPrice,
    mktPrice: p.mktPrice,
    mktValue: p.mktValue,
    unrealizedPnl: p.unrealizedPnl,
    realizedPnl: p.realizedPnl,
    currency: p.currency,
    assetClass: p.assetClass,
    expiry: normalizeExpiry(p.expiry) ?? fb.expiry ?? null,
    strike: p.strike != null && p.strike > 0 ? p.strike : fb.strike ?? null,
    putOrCall: p.putOrCall ?? fb.putOrCall ?? null,
    multiplier: p.multiplier ?? null,
    underlyingConid: p.underlyingConid ?? p.undConid,
  };
}

export async function getPositions(accountId: string): Promise<Position[]> {
  const all: Position[] = [];
  for (let page = 0; page < 20; page++) {
    const rows = await ibkr<RawPosition[]>(`/portfolio/${accountId}/positions/${page}`);
    if (!rows || rows.length === 0) break;
    all.push(...rows.map(adaptPosition));
    if (rows.length < 30) break;
  }
  return all;
}

interface RawSummaryField {
  amount: number;
  currency: string | null;
  isNull: boolean;
  timestamp: number;
  value: string | null;
  severity: number;
}
type RawSummary = Record<string, RawSummaryField>;

function pickAmount(s: RawSummary, key: string): number {
  return s[key]?.amount ?? 0;
}

export async function getSummary(accountId: string): Promise<PortfolioSummary> {
  const s = await ibkr<RawSummary>(`/portfolio/${accountId}/summary`);
  const baseCurrency: Currency = s.netliquidation?.currency ?? "USD";
  return {
    accountId,
    baseCurrency,
    netLiquidation: pickAmount(s, "netliquidation"),
    totalCash: pickAmount(s, "totalcashvalue"),
    availableFunds: pickAmount(s, "availablefunds"),
    buyingPower: pickAmount(s, "buyingpower"),
    initMarginReq: pickAmount(s, "initmarginreq"),
    maintMarginReq: pickAmount(s, "maintmarginreq"),
    grossPositionValue: pickAmount(s, "grosspositionvalue"),
    rawTimestamp: s.netliquidation?.timestamp ?? Date.now(),
  };
}

interface RawLedgerEntry {
  currency: string;
  cashbalance: number;
  netliquidationvalue: number;
  unrealizedpnl: number;
  realizedpnl: number;
  exchangerate: number;
  stockmarketvalue: number;
  stockoptionmarketvalue: number;
}
type RawLedger = Record<string, RawLedgerEntry>;

export async function getLedger(accountId: string): Promise<LedgerEntry[]> {
  const l = await ibkr<RawLedger>(`/portfolio/${accountId}/ledger`);
  return Object.entries(l).map(([currency, e]) => ({
    currency,
    cashBalance: e.cashbalance,
    netLiquidationValue: e.netliquidationvalue,
    unrealizedPnl: e.unrealizedpnl,
    realizedPnl: e.realizedpnl,
    exchangeRate: e.exchangerate,
    stockMarketValue: e.stockmarketvalue,
    optionMarketValue: e.stockoptionmarketvalue,
  }));
}

export async function getPortfolio(): Promise<Portfolio> {
  const account = await resolveAccount();
  const [summary, positions, ledger] = await Promise.all([
    getSummary(account.accountId),
    getPositions(account.accountId),
    getLedger(account.accountId),
  ]);
  return {
    accountId: account.accountId,
    accountType: account.accountType,
    isPaper: account.isPaper,
    baseCurrency: summary.baseCurrency,
    summary,
    positions,
    ledger,
  };
}

export function findHeldPositions(portfolio: Portfolio | null, t: string): Position[] {
  if (!portfolio) return [];
  const tk = t.toUpperCase();
  return portfolio.positions.filter((p) => {
    if (p.assetClass === "STK") return p.contractDesc.toUpperCase() === tk;
    if (p.assetClass === "OPT") return p.contractDesc.trim().toUpperCase().startsWith(tk + " ");
    return false;
  });
}

