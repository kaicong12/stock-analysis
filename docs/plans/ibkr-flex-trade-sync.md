# IBKR Flex Query → Trade History & PnL Calendar

## Goal

Replace the manual trade journal as the data source for the PnL calendar. Pull executed/expired/assigned trades from IBKR's Flex Web Service on first login each day, upsert into local SQLite, and aggregate by trade date for the calendar.

## Why Flex (vs alternatives we considered)

| Endpoint | Lookback | Filter by asset class | Per-trade realized PnL | "All trades" without enumerating conids | Already auth'd in app |
| --- | --- | --- | --- | --- | --- |
| `/iserver/account/trades` | 7 days (hard cap) | client-side (`sec_type`) | no | yes | yes |
| `/pa/transactions` | months | client-side | yes (in `rpnl.data`) | **no** — must pass `conids[]` | yes |
| **Flex Web Service** | any range | server-side (`assetCategory`) | yes (`fifoPnlRealized`) | yes | no (separate token) |

Flex is the only option that covers a 30+ day window with full coverage and per-trade realized PnL in one request.

## Architecture

```
                     ┌─ Client (Calendar.tsx)
                     │     on mount, once per day,
                     │     POST /api/trades/sync  (fire-and-forget)
                     │     then GET /api/trades/pnl?year=...&month=...
                     ▼
        ┌────────────────────────────┐
        │ /api/trades/sync           │ ───► IBKR Flex Web Service (2-step)
        │  - dedupe-aware            │      SendRequest → poll GetStatement
        │  - upsert by transactionID │
        └────────────────────────────┘
                     │
                     ▼
        SQLite ibkr_trades (one row per fill)
                     ▲
        ┌────────────────────────────┐
        │ /api/trades/pnl            │ ──► SELECT trade_date,
        │  filters: year/month       │      SUM(fifo_pnl_realized)
        │           assetClass       │      FROM ibkr_trades
        └────────────────────────────┘      WHERE ... GROUP BY trade_date
```

## Flex Query setup (already done in IBKR Account Management)

- Token + Query ID stored in `.env` as `IBKR_FLEX_TOKEN` and `IBKR_FLEX_QUERY_ID`.
- Query name: `TradesWithPnL`, format XML, period **Last 30 Calendar Days** (decision below).
- Trades section fields confirmed in live response: `accountId, currency, assetCategory, symbol, description, conid, securityID, listingExchange, multiplier, strike, expiry, putCall, tradeDate, settleDateTarget, transactionType, exchange, quantity, tradePrice, tradeMoney, proceeds, taxes, ibCommission, ibCommissionCurrency, netCash, closePrice, openCloseIndicator, notes, cost, fifoPnlRealized, mtmPnl, buySell, ibOrderID, transactionID, orderTime`.
- **Outstanding edit**: Trades section's transaction-type filter must include `Expired`, `Assigned`, and `BookTrade` in addition to `ExchTrade`. Today's pulls show only `ExchTrade` — confirm this is the saved-query filter, not a coincidence of the window.

### Verified response shape (sample row)

```xml
<Trade accountId="U19835530" currency="USD" assetCategory="OPT"
  symbol="AAPL  260612P00270000" description="AAPL 12JUN26 270 P"
  conid="878924579" multiplier="100" strike="270" expiry="20260612" putCall="P"
  tradeDate="20260507" transactionType="ExchTrade"
  quantity="1" tradePrice="2.45" proceeds="-245"
  ibCommission="-0.69825" netCash="-245.7610925"
  openCloseIndicator="O" fifoPnlRealized="0" mtmPnl="19.5"
  buySell="BUY" ibOrderID="62588110" transactionID="806947995"
  orderTime="20260507;111449" />
```

### Two-step protocol

1. `GET https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest?t={token}&q={queryId}&v=3`
   → returns `<ReferenceCode>` (e.g. `4500347048`).
2. `GET https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement?t={token}&q={referenceCode}&v=3`
   → may return `<code>1019</code>` ("Statement generation in progress"). Retry with backoff until XML statement body comes back.
3. Reports are **T+1** — today's fills appear tomorrow. UI should label "Last synced: …" so this is obvious.

## Schema (new migration in `src/lib/storage/db.ts`)

```sql
CREATE TABLE ibkr_trades (
  transaction_id     TEXT PRIMARY KEY,   -- Flex transactionID, globally unique per fill
  account_id         TEXT NOT NULL,
  trade_date         TEXT NOT NULL,      -- YYYY-MM-DD (normalized from YYYYMMDD)
  asset_category     TEXT NOT NULL,      -- STK | OPT | CASH
  symbol             TEXT NOT NULL,
  description        TEXT,
  conid              INTEGER,
  strike             REAL,
  expiry             TEXT,               -- YYYY-MM-DD
  put_call           TEXT,               -- C | P | NULL
  multiplier         INTEGER,
  transaction_type   TEXT NOT NULL,      -- ExchTrade | Expired | Assigned | BookTrade
  buy_sell           TEXT NOT NULL,      -- BUY | SELL
  quantity           REAL NOT NULL,
  trade_price        REAL,
  proceeds           REAL,
  ib_commission      REAL,
  net_cash           REAL,
  open_close         TEXT,               -- O | C
  fifo_pnl_realized  REAL NOT NULL DEFAULT 0,
  mtm_pnl            REAL,
  currency           TEXT NOT NULL,      -- trade currency (often USD even when base is SGD)
  ib_order_id        TEXT,
  order_time         TEXT,
  raw_json           TEXT NOT NULL,      -- preserve original row for forensics
  inserted_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ibkr_trades_date  ON ibkr_trades(trade_date);
CREATE INDEX idx_ibkr_trades_class ON ibkr_trades(asset_category, trade_date);

CREATE TABLE ibkr_flex_sync (
  query_id         TEXT PRIMARY KEY,
  last_success_at  TEXT,                 -- ISO timestamp of last good pull
  last_window_to   TEXT,                 -- toDate (YYYY-MM-DD) of last good pull
  last_attempt_at  TEXT,                 -- so concurrent triggers can short-circuit
  last_error       TEXT,
  trades_seen      INTEGER NOT NULL DEFAULT 0
);
```

Upsert key is `transaction_id`. Re-running the sync N times is safe and cheap.

## Sync flow

```
syncTradesFromFlex():
  1. Load ibkr_flex_sync row for the configured query_id.
  2. If last_attempt_at is within the last 60s AND last_success_at == today → return { skipped: "fresh" }.
  3. Stamp last_attempt_at = now (so concurrent triggers see it).
  4. SendRequest → poll GetStatement (retry on code 1019, bounded ~10 × 4s).
  5. Parse XML; for each <Trade>:
       INSERT INTO ibkr_trades (...) VALUES (...)
       ON CONFLICT(transaction_id) DO UPDATE SET ...all fields..., updated_at = CURRENT_TIMESTAMP
     in one transaction.
  6. Update ibkr_flex_sync: last_success_at = now, last_window_to = today, trades_seen += new rows.
  7. On any error → stamp last_error, leave last_success_at unchanged.
```

## "First login each day" trigger

No server session in this app, so the trigger is client-side:

```tsx
useEffect(() => {
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem("flexSyncDate") === today) return;
  fetch("/api/trades/sync", { method: "POST" })
    .then(() => localStorage.setItem("flexSyncDate", today));
}, []);
```

Server still guards itself via `ibkr_flex_sync.last_attempt_at`. Sync also fires on every Calendar open as a second-chance retry — server-side dedupe makes the extra call free.

## Endpoints

- **`POST /api/trades/sync`** — runs Flex pull + upsert. Returns `{ status: "ok"|"skipped"|"error", trades_seen, last_success_at, last_error? }`. Idempotent.
- **`GET /api/trades/pnl?year=YYYY&month=MM&assetClass=STK|OPT|all`** — replaces `/api/journal/pnl`. Returns `{ data: { [day]: pnl } }` so `Calendar.tsx` only changes its fetch URL.

## Don't-miss-data risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **T+1 lag** — today's fills aren't in Flex until tomorrow | Acceptable for a daily calendar. UI shows `Last synced: ...` timestamp. |
| **User doesn't log in for >30 days** → trades fall out of the Flex window before we ever pull them | Daily sync trigger is load-bearing. Mitigations: (a) trigger fires on every Calendar open, not just first-login; (b) **staleness banner** — if `last_success_at` is >25 days ago or sync has failed N times, show a red warning on the calendar: *"Trade sync stale — risk of missing data older than {date}"*. |
| **Restated trades** — IBKR amends commission/tax after the fact | Upsert by `transactionID` overwrites changed columns. No special handling. |
| **Busted/cancelled trades** | Rare. Out of scope for v1. If needed later: diff the set of `transactionID`s returned today against existing rows in the overlapping window; flag missing IDs. |
| **Expirations & assignments missing from query output** | Confirmed today's pulls show only `transactionType="ExchTrade"`. Re-edit the saved Flex Query to include `Expired`/`Assigned`/`BookTrade` and re-test before persistence is written. |
| **Currency mismatch** (trade USD vs account base SGD) | v1 stores trade currency on each row and shows totals in USD. The mobile app's SGD conversion uses `fxRateToBase`, which we can add to the query later. |
| **Concurrent triggers** | `ibkr_flex_sync.last_attempt_at` check; upsert is transactional. |
| **Flex auth/token issues** | Failures stamp `last_error`; `/api/trades/sync` surfaces it in the response; UI banner reads it. |

## Decisions made

- **Flex window**: **Last 30 Calendar Days** (kept). Daily sync is now load-bearing — mitigated by per-open trigger + staleness banner.
- **Transaction types**: include `Expired`, `Assigned`, `BookTrade` in addition to `ExchTrade` (Flex Query edit pending).
- **Currency**: keep PnL in USD for v1; SGD conversion can come later via `fxRateToBase`.
- **Trade journal**: keep `journal_trades` / `journal_legs` tables (still used for thesis tracking + IBKR order linking). Just no longer the PnL source.

## What stays / what goes

- `journal_trades`, `journal_legs` — keep.
- `/api/journal/pnl` — can stay; calendar stops calling it either way.
- `Calendar.tsx` — one-line URL swap + daily-trigger `useEffect` + staleness banner.

## Implementation order

1. Migration: add `ibkr_trades` + `ibkr_flex_sync` in `src/lib/storage/db.ts`.
2. `src/lib/ibkr/flex.ts` — `sendRequest()`, `pollStatement()`, XML parser → typed `FlexTrade[]`.
3. `src/lib/trades/sync.ts` — `syncTradesFromFlex()` (dedupe, upsert transaction, error stamping).
4. `POST /api/trades/sync` route.
5. `GET /api/trades/pnl` route.
6. `Calendar.tsx` — swap fetch URL, add daily-trigger `useEffect`, add staleness banner.
7. Re-confirm Flex Query response (after user re-edits to include expirations/assignments) before shipping.

## Reference: real numbers from today's verification pull

- 30-day window (2026-04-16 → 2026-05-15), account U19835530.
- 95 trades total: 76 OPT, 8 STK, 11 CASH (FX conversions).
- Realized PnL USD: OPT +$166.26, STK +$173.92, total **+$340.19**.
- Mobile app's "Past 30 days, Options only" shows **214.25 SGD** — matches `$166.26 × ~1.289 SGD/USD`. Confirmed Flex data is correct; difference was just denomination.
