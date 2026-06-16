import datetime as dt
import math
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from statistics import stdev
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from moomoo import OpenQuoteContext, OptionType, RET_OK

OPEND_HOST = os.getenv("FUTU_OPEND_HOST", "127.0.0.1")
OPEND_PORT = int(os.getenv("FUTU_OPEND_PORT", "11111"))

app = FastAPI(title="moomoo-sidecar")

_lock = threading.Lock()


@contextmanager
def quote_ctx():
    with _lock:
        ctx = OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
        try:
            yield ctx
        finally:
            ctx.close()


def _normalize(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        try:
            return _normalize(value.to_dict(orient="records"))
        except TypeError:
            return _normalize(value.to_dict())
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(v) for v in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def _split(values: list[str] | None) -> list[str] | None:
    if not values:
        return None
    out: list[str] = []
    for v in values:
        for part in str(v).split(","):
            part = part.strip()
            if part:
                out.append(part)
    return out or None


def _call(method_name: str, symbol: str, time_range: int, dims: list[str] | None,
          language_id: int, dim_kwarg: str = "analysis_dimensions") -> dict:
    with quote_ctx() as ctx:
        method = getattr(ctx, method_name)
        kwargs = {"time_range": time_range, "language_id": language_id, dim_kwarg: dims}
        ret, data = method(symbol, **kwargs)
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"{method_name}: {data}")
    return {
        "method": method_name,
        "symbol": symbol,
        "time_range": time_range,
        "language_id": language_id,
        "dimensions": dims or [],
        "data": _normalize(data),
    }


# ---- Anomaly dimension handling ---------------------------------------------
# moomoo currently returns err_code -12301 (empty payload) for several anomaly
# dimensions on EVERY symbol/market we tested. Because a single request that
# bundles multiple dimensions fails entirely if ANY one of them errors, a full
# scan (analysis_dimensions=None -> "all") always comes back -12301 and the
# panels render blank. Workaround: query only the dimensions that return data
# today, one at a time, and merge the successful ones. See SUPPORT_TICKET.md.
#
# To re-enable a dimension once moomoo fixes it, just add it back to the list;
# _merge_dimensions already skips any dimension that errors at runtime, so a
# still-broken entry degrades gracefully instead of blanking the whole panel.
FINANCIAL_DIMENSIONS: list[tuple[str, str]] = [
    ("funds_distribution", "Funds Distribution (资金分布)"),
    ("funds_broker", "Buy/Sell Brokers (买卖经纪商)"),
    # Broken as of last check (-12301): funds_flow, short_sell_number,
    # short_sell_ratio, short_sell_number_and_ratio.
]
DERIVATIVE_DIMENSIONS: list[tuple[str, str]] = [
    ("option_unusual", "Unusual Options Trades (期权大单)"),
    # Broken as of last check (-12301): option_volatility, option_volume_price,
    # option_sentiment, option_comprehensive. warrant_ratio /
    # warrant_price_distribution are HK-only CBBC concepts (also -12301 on HK)
    # and irrelevant to US options strategy, so they are intentionally omitted.
]


def _dim_succeeded(err_code) -> bool:
    """err_code semantics from the moomoo skill-wrap anomaly API:
    0 = success with content, 1 = success/no-anomaly, <0 = error (e.g. -12301).
    """
    return isinstance(err_code, int) and err_code >= 0


def _merge_dimensions(method_name: str, symbol: str, time_range: int,
                      language_id: int, dimensions: list[tuple[str, str]]) -> dict:
    """Call each anomaly dimension individually and merge the ones that return
    successfully. Mirrors the envelope shape of _call so the Next.js sidecar
    (RawAnomalyResponse) keeps working unchanged: data.content holds the merged
    text, plus a per_dimension diagnostic map for debugging which dims errored.
    """
    sections: list[str] = []
    per_dimension: dict[str, dict] = {}
    time_range_label = ""
    any_succeeded = False

    with quote_ctx() as ctx:
        method = getattr(ctx, method_name)
        for dim, label in dimensions:
            ret, data = method(symbol, time_range=time_range,
                               language_id=language_id, analysis_dimensions=[dim])
            if ret != RET_OK:
                per_dimension[dim] = {"err_code": None, "retMsg": str(data)[:200]}
                continue
            rec = _normalize(data)
            if isinstance(rec, list):
                rec = rec[0] if rec else {}
            if not isinstance(rec, dict):
                rec = {}
            err_code = rec.get("err_code")
            content = (rec.get("content") or "").strip()
            per_dimension[dim] = {"err_code": err_code, "retMsg": rec.get("retMsg")}
            if not _dim_succeeded(err_code):
                continue
            any_succeeded = True
            time_range_label = time_range_label or (rec.get("time_range") or "")
            if content:
                sections.append(f"{label}:\n{content}")

    if sections:
        err_code, ret_msg = 0, "success"
    elif any_succeeded:
        err_code, ret_msg = 1, "no anomaly"
    else:
        # Every queried dimension errored — surface it so the panel can tell the
        # difference between "no anomaly" and "data unavailable".
        err_code, ret_msg = -12301, "all requested dimensions unavailable"

    return {
        "method": method_name,
        "symbol": symbol,
        "time_range": time_range,
        "language_id": language_id,
        "dimensions": [d for d, _ in dimensions],
        "data": {
            "err_code": err_code,
            "retMsg": ret_msg,
            "time_range": time_range_label,
            "content": "\n\n".join(sections),
            "per_dimension": per_dimension,
        },
    }


@app.get("/health")
def health() -> dict:
    try:
        with quote_ctx() as ctx:
            ret, _ = ctx.get_global_state()
        return {"ok": ret == RET_OK, "opend": f"{OPEND_HOST}:{OPEND_PORT}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "opend": f"{OPEND_HOST}:{OPEND_PORT}"}


@app.get("/anomaly/capital")
def capital_anomaly(
    symbol: str = Query(..., description="e.g. US.AAPL"),
    time_range: int = 30,
    language_id: int = 2,
    dimensions: list[str] | None = Query(default=None),
):
    dims = [(d, d) for d in _split(dimensions)] if _split(dimensions) else FINANCIAL_DIMENSIONS
    return _merge_dimensions("get_financial_unusual", symbol, time_range, language_id, dims)


@app.get("/anomaly/technical")
def technical_anomaly(
    symbol: str = Query(...),
    time_range: int = 30,
    language_id: int = 2,
    indicators: list[str] | None = Query(default=None),
):
    return _call("get_technical_unusual", symbol, time_range, _split(indicators),
                 language_id, dim_kwarg="indicator_filters")


@app.get("/anomaly/derivatives")
def derivatives_anomaly(
    symbol: str = Query(...),
    time_range: int = 30,
    language_id: int = 2,
    dimensions: list[str] | None = Query(default=None),
):
    dims = [(d, d) for d in _split(dimensions)] if _split(dimensions) else DERIVATIVE_DIMENSIONS
    return _merge_dimensions("get_derivative_unusual", symbol, time_range, language_id, dims)


# ---- Options ----------------------------------------------------------------
# Moomoo Lv1 (real-time OPRA on US options):
# - get_market_snapshot([opt_codes]) → bid/ask/last/IV/greeks/OI in one shot
# No polling, no chunking, no rate-limit dance — the IBKR options module this
# replaces was 540 lines of mitigations for snapshot quirks that don't exist
# here.


@app.get("/options/snapshot")
def option_snapshot(codes: str = Query(..., description="comma-separated moomoo option codes")):
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if not code_list:
        raise HTTPException(status_code=400, detail="codes is required")
    out: list[dict] = []
    with quote_ctx() as ctx:
        CHUNK = 200
        for i in range(0, len(code_list), CHUNK):
            batch = code_list[i : i + CHUNK]
            ret, snap = ctx.get_market_snapshot(batch)
            if ret != RET_OK:
                raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap}")
            rows = _normalize(snap) if snap is not None else []
            if isinstance(rows, list):
                out.extend(rows)
    return {"codes": code_list, "data": out}


@app.get("/snapshot")
def snapshot(symbol: str = Query(..., description="e.g. US.AAPL")):
    with quote_ctx() as ctx:
        ret, data = ctx.get_market_snapshot([symbol])
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"get_market_snapshot: {data}")
    rows = _normalize(data)
    return {"symbol": symbol, "data": rows[0] if isinstance(rows, list) and rows else rows}


# Large-cap sector peers via OpenD plates. Resolves the ticker's INDUSTRY plate,
# pulls constituents, and filters to the CLAUDE.md universe ($10B+ cap, >= $20).
# No news here — just the peer graph; the TS layer fans out news per peer.
# Membership barely moves, so callers should cache this (≈1 day): the underlying
# get_owner_plate / get_plate_stock calls are rate-limited to 10 req / 30s.
PEERS_MIN_CAP = 10_000_000_000  # $10B large-cap floor
PEERS_MIN_PRICE = 20            # CLAUDE.md abovePrice


@app.get("/peers/{symbol}")
def peers(symbol: str, top: int = 8):
    with quote_ctx() as ctx:
        ret, plates = ctx.get_owner_plate([symbol])
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_owner_plate: {plates}")
        industry = [r for r in plates.to_dict("records") if r.get("plate_type") == "INDUSTRY"]
        if not industry:
            return {"symbol": symbol, "industryPlate": None, "peers": []}
        plate = industry[0]
        ret, stocks = ctx.get_plate_stock(plate["plate_code"])
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_plate_stock: {stocks}")
        codes = [r["code"] for r in stocks.to_dict("records")]
        if not codes:
            return {"symbol": symbol, "industryPlate": plate["plate_name"], "peers": []}
        # snapshot is capped at 400 codes/req; industry plates are well under that
        ret, snap = ctx.get_market_snapshot(codes)
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap}")

    out = []
    for s in _normalize(snap):
        cap = s.get("total_market_val") or 0
        price = s.get("last_price") or 0
        if s.get("code") == symbol:
            continue
        if cap >= PEERS_MIN_CAP and price >= PEERS_MIN_PRICE:
            out.append({"code": s["code"], "name": s.get("name"),
                        "capBn": round(cap / 1e9, 1), "price": price})
    out.sort(key=lambda x: x["capBn"], reverse=True)
    return {"symbol": symbol, "industryPlate": plate["plate_name"], "peers": out[:top]}


# yfinance ticker mapping. moomoo uses MARKET.CODE; yfinance uses suffixes
# (or none for US). Hong Kong codes need 4-digit zero-padding.
def _to_yf_ticker(symbol: str) -> str:
    if "." not in symbol:
        return symbol
    market, code = symbol.split(".", 1)
    market = market.upper()
    if market == "US":
        return code
    if market == "HK":
        return f"{code.lstrip('0').zfill(4)}.HK"
    if market == "SH":
        return f"{code}.SS"
    if market == "SZ":
        return f"{code}.SZ"
    if market == "SG":
        return f"{code}.SI"
    return code


def _f(value: Any) -> float | None:
    try:
        if value is None:
            return None
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


@app.get("/fundamentals")
def fundamentals(symbol: str = Query(..., description="e.g. US.AAPL")):
    import yfinance as yf  # lazy: avoid cold-start cost on unrelated routes

    yf_ticker = _to_yf_ticker(symbol)
    try:
        t = yf.Ticker(yf_ticker)
        info = t.info or {}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"yfinance: {exc}")

    # Next earnings date — yfinance exposes this via calendar; fall back to None.
    next_earnings: str | None = None
    try:
        cal = t.calendar
        if hasattr(cal, "to_dict"):
            cd = cal.to_dict()
            ev = cd.get("Earnings Date") or cd.get("Earnings Date ", {})
            if isinstance(ev, dict) and ev:
                first = next(iter(ev.values()), None)
                next_earnings = str(first)[:10] if first is not None else None
        elif isinstance(cal, dict):
            ev = cal.get("Earnings Date")
            if isinstance(ev, list) and ev:
                next_earnings = str(ev[0])[:10]
            elif ev is not None:
                next_earnings = str(ev)[:10]
    except Exception:
        next_earnings = None

    return {
        "symbol": symbol,
        "yfTicker": yf_ticker,
        "data": {
            "shortName": info.get("shortName") or info.get("longName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "marketCap": _f(info.get("marketCap")),
            "trailingPE": _f(info.get("trailingPE")),
            "forwardPE": _f(info.get("forwardPE")),
            "pegRatio": _f(info.get("pegRatio") or info.get("trailingPegRatio")),
            "priceToBook": _f(info.get("priceToBook")),
            "priceToSales": _f(info.get("priceToSalesTrailing12Months")),
            "trailingEps": _f(info.get("trailingEps")),
            "forwardEps": _f(info.get("forwardEps")),
            "earningsGrowth": _f(info.get("earningsGrowth")),
            "earningsQuarterlyGrowth": _f(info.get("earningsQuarterlyGrowth")),
            "revenueGrowth": _f(info.get("revenueGrowth")),
            "revenueTtm": _f(info.get("totalRevenue")),
            "profitMargins": _f(info.get("profitMargins")),
            "operatingMargins": _f(info.get("operatingMargins")),
            "grossMargins": _f(info.get("grossMargins")),
            "debtToEquity": _f(info.get("debtToEquity")),
            "totalDebt": _f(info.get("totalDebt")),
            "totalCash": _f(info.get("totalCash")),
            "freeCashflow": _f(info.get("freeCashflow")),
            "operatingCashflow": _f(info.get("operatingCashflow")),
            "returnOnEquity": _f(info.get("returnOnEquity")),
            "returnOnAssets": _f(info.get("returnOnAssets")),
            "currentRatio": _f(info.get("currentRatio")),
            "quickRatio": _f(info.get("quickRatio")),
            "dividendYield": _f(info.get("dividendYield")),
            "payoutRatio": _f(info.get("payoutRatio")),
            "beta": _f(info.get("beta")),
            "fiftyTwoWeekHigh": _f(info.get("fiftyTwoWeekHigh")),
            "fiftyTwoWeekLow": _f(info.get("fiftyTwoWeekLow")),
            "currentPrice": _f(info.get("currentPrice") or info.get("regularMarketPrice")),
            "targetMeanPrice": _f(info.get("targetMeanPrice")),
            "targetHighPrice": _f(info.get("targetHighPrice")),
            "targetLowPrice": _f(info.get("targetLowPrice")),
            "recommendationKey": info.get("recommendationKey"),
            "numberOfAnalystOpinions": _f(info.get("numberOfAnalystOpinions")),
            "shortPercentOfFloat": _f(info.get("shortPercentOfFloat")),
            "heldPercentInsiders": _f(info.get("heldPercentInsiders")),
            "heldPercentInstitutions": _f(info.get("heldPercentInstitutions")),
            "currency": info.get("currency"),
            "nextEarningsDate": next_earnings,
        },
    }


# ---- Volatility summary (ATM IV + HV + skew) --------------------------------
# Structured replacement for letting the derivatives panel infer IV/HV/skew from
# the anomaly report's free text. Industry-standard HV: close-to-close log
# returns × sqrt(252) over a 30 trading-day window.

# yfinance daily-closes cache. Persisted in the shared app.sqlite (same file
# Next.js uses for the trade journal + Flex sync) via two tables:
#   daily_closes(yf_ticker, close_date, close)            -- the bars
#   daily_closes_sync(yf_ticker, last_refresh_date, n)    -- refresh log
# Schema is owned by Next.js (src/lib/storage/db.ts migration slot 7). We use
# CREATE TABLE IF NOT EXISTS here so the sidecar can run standalone before
# Next.js has applied the migration.
_DB_FILE = Path(__file__).resolve().parent.parent / "data" / "app.sqlite"
_db_lock = threading.Lock()
_db_inited = False


def _db_init() -> None:
    """Idempotent. Ensures the daily_closes tables exist. WAL is set by Next.js
    on first migration — we don't re-toggle it here."""
    global _db_inited
    if _db_inited:
        return
    with _db_lock:
        if _db_inited:
            return
        _DB_FILE.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(_DB_FILE, timeout=5) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS daily_closes (
                  yf_ticker   TEXT NOT NULL,
                  close_date  TEXT NOT NULL,
                  close       REAL NOT NULL,
                  PRIMARY KEY (yf_ticker, close_date)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS daily_closes_sync (
                  yf_ticker          TEXT PRIMARY KEY,
                  last_refresh_date  TEXT NOT NULL,
                  bars_count         INTEGER NOT NULL DEFAULT 0
                )
            """)
            # OHLCV bars for the price-action / breakdown signal. Closes alone
            # (daily_closes) don't carry the open + volume needed for gap and
            # volume-confirmation, so this is a separate cache with the same
            # once-per-calendar-day refresh discipline.
            conn.execute("""
                CREATE TABLE IF NOT EXISTS daily_ohlcv (
                  yf_ticker   TEXT NOT NULL,
                  bar_date    TEXT NOT NULL,
                  open        REAL NOT NULL,
                  high        REAL NOT NULL,
                  low         REAL NOT NULL,
                  close       REAL NOT NULL,
                  volume      REAL NOT NULL,
                  PRIMARY KEY (yf_ticker, bar_date)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS daily_ohlcv_sync (
                  yf_ticker          TEXT PRIMARY KEY,
                  last_refresh_date  TEXT NOT NULL,
                  bars_count         INTEGER NOT NULL DEFAULT 0
                )
            """)
            conn.commit()
        _db_inited = True


@contextmanager
def _db():
    _db_init()
    # busy_timeout (via timeout kwarg) lets us wait out brief writer locks
    # from the Next.js process instead of getting SQLITE_BUSY immediately.
    conn = sqlite3.connect(_DB_FILE, timeout=5)
    try:
        yield conn
    finally:
        conn.close()


def _fetch_daily_closes(yf_ticker: str, n_bars: int = 80) -> list[float]:
    """Return the most recent N daily closes (ascending) for the ticker.
    Hits yfinance at most once per calendar day per ticker — subsequent calls
    read from SQLite. n_bars sized for a 60-day HV window with headroom."""
    today_iso = dt.date.today().isoformat()

    with _db() as conn:
        row = conn.execute(
            "SELECT last_refresh_date FROM daily_closes_sync WHERE yf_ticker = ?",
            (yf_ticker,),
        ).fetchone()
        if row and row[0] == today_iso:
            rows = conn.execute(
                "SELECT close FROM daily_closes WHERE yf_ticker = ? "
                "ORDER BY close_date DESC LIMIT ?",
                (yf_ticker, n_bars),
            ).fetchall()
            if len(rows) >= 32:
                # ascending (oldest first) — same convention as the HV math
                return [float(r[0]) for r in reversed(rows)]

    import yfinance as yf  # lazy import — already used by /fundamentals
    # Request more calendar days than n_bars to absorb weekends + holidays.
    # 60 trading days ≈ 88 calendar days; ask for 120 to be safe.
    period_days = max(n_bars * 2, 120)
    try:
        t = yf.Ticker(yf_ticker)
        hist = t.history(period=f"{period_days}d", interval="1d", auto_adjust=False)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"yfinance history: {exc}")
    if hist is None or hist.empty or "Close" not in hist:
        return []

    bars: list[tuple[str, float]] = []
    for ts, r in hist.iterrows():
        close = r.get("Close")
        if close is None:
            continue
        c = float(close)
        if math.isnan(c) or math.isinf(c):
            continue
        date_iso = ts.strftime("%Y-%m-%d")
        bars.append((date_iso, c))
    if not bars:
        return []
    bars = bars[-n_bars:]

    with _db() as conn:
        with conn:  # implicit transaction
            conn.executemany(
                "INSERT OR REPLACE INTO daily_closes (yf_ticker, close_date, close) "
                "VALUES (?, ?, ?)",
                [(yf_ticker, d, c) for d, c in bars],
            )
            conn.execute(
                "INSERT OR REPLACE INTO daily_closes_sync "
                "(yf_ticker, last_refresh_date, bars_count) VALUES (?, ?, ?)",
                (yf_ticker, today_iso, len(bars)),
            )

    return [c for _, c in bars]


def _compute_hv(closes: list[float], window: int) -> float | None:
    """Annualized historical volatility from close-to-close log returns.

    Industry standard: trading-day basis, annualize by sqrt(252). Sample stddev
    (Bessel-corrected) is the cme/cboe convention for realized vol. Returns a
    decimal (e.g. 0.27 for 27% annualized) or None if there aren't enough bars.
    """
    if len(closes) < window + 1:
        return None
    sub = closes[-(window + 1):]
    returns: list[float] = []
    for i in range(1, len(sub)):
        a, b = sub[i - 1], sub[i]
        if a <= 0 or b <= 0:
            continue
        returns.append(math.log(b / a))
    if len(returns) < 2:
        return None
    return stdev(returns) * math.sqrt(252)


def _nearest(rows: list[dict], key: str, target: float) -> dict | None:
    if not rows:
        return None
    return min(rows, key=lambda r: abs(r[key] - target))


@app.get("/options/vol-summary")
def vol_summary(
    symbol: str = Query(..., description="e.g. US.AAPL"),
    target_dte: int = Query(30, description="Expiry closest to N DTE for IV sampling"),
):
    """Structured IV/HV/skew snapshot — feeds the derivatives panel with hard
    numbers instead of free-text inference.

    Returns (all decimals; 0.32 = 32%):
      spot                current spot price
      expiry_used         ISO date of the sampled expiry (closest to target_dte)
      dte                 actual DTE of that expiry
      atm_iv              average of call+put ATM IV at the chosen expiry
      atm_iv_call/put     per-side ATM IV (strike closest to spot)
      atm_strike_call/put strikes used for atm_iv_call/put
      hv_30               30 trading-day annualized HV (industry standard window)
      hv_60               60 trading-day HV for context
      iv_hv_ratio         atm_iv / hv_30 — > 1.10 = meaningful IV premium
      skew_25d            put_iv(Δ≈-0.25) - call_iv(Δ≈+0.25); + = put skew
      skew_25d_*_strike   strikes used for skew (sanity-check the picks)
      hv_sample_size      number of daily returns used for hv_30
    """
    yf_ticker = _to_yf_ticker(symbol)
    today = dt.date.today()

    # 1) Daily closes + HV (yfinance, cached on disk).
    closes = _fetch_daily_closes(yf_ticker, n_bars=80)
    hv_30 = _compute_hv(closes, window=30)
    hv_60 = _compute_hv(closes, window=60)

    # 2) Spot + chain + per-contract snapshot (moomoo). One quote_ctx for the
    # whole request.
    with quote_ctx() as ctx:
        ret, snap = ctx.get_market_snapshot([symbol])
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap}")
        snap_rows = _normalize(snap) if snap is not None else []
        spot = _f(snap_rows[0].get("last_price")) if isinstance(snap_rows, list) and snap_rows else None
        if not spot or spot <= 0:
            raise HTTPException(status_code=502, detail=f"no spot for {symbol}")

        ret, exp = ctx.get_option_expiration_date(code=symbol)
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_option_expiration_date: {exp}")
        exp_rows = _normalize(exp) if exp is not None else []
        if not isinstance(exp_rows, list) or not exp_rows:
            raise HTTPException(status_code=502, detail=f"no option expiries for {symbol}")

        target_date = today + dt.timedelta(days=target_dte)
        chosen: tuple[str, dt.date] | None = None
        chosen_diff: int | None = None
        for r in exp_rows:
            s = r.get("strike_time")
            if not isinstance(s, str):
                continue
            try:
                d = dt.date.fromisoformat(s[:10])
            except ValueError:
                continue
            if d < today:
                continue
            diff = abs((d - target_date).days)
            if chosen_diff is None or diff < chosen_diff:
                chosen, chosen_diff = (s[:10], d), diff
        if not chosen:
            raise HTTPException(status_code=502, detail=f"no future expiry for {symbol}")
        expiry_iso, expiry_date = chosen
        dte = (expiry_date - today).days

        ret, chain = ctx.get_option_chain(
            code=symbol, start=expiry_iso, end=expiry_iso, option_type=OptionType.ALL,
        )
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_option_chain: {chain}")
        chain_rows = _normalize(chain) if chain is not None else []
        if not isinstance(chain_rows, list):
            chain_rows = []
        # ±25% strike window is wide enough to bracket the 25Δ wings on
        # normal-IV names and small enough to keep the snapshot batch < 100.
        lo, hi = spot * 0.75, spot * 1.25
        chain_rows = [r for r in chain_rows
                      if isinstance(r.get("strike_price"), (int, float))
                      and lo <= r["strike_price"] <= hi]
        if not chain_rows:
            raise HTTPException(status_code=502, detail=f"empty chain at expiry {expiry_iso}")

        codes = [r["code"] for r in chain_rows if isinstance(r.get("code"), str)]
        snap_by_code: dict[str, dict] = {}
        CHUNK = 200
        for i in range(0, len(codes), CHUNK):
            batch = codes[i : i + CHUNK]
            ret, snap2 = ctx.get_market_snapshot(batch)
            if ret != RET_OK:
                raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap2}")
            sr = _normalize(snap2) if snap2 is not None else []
            if isinstance(sr, list):
                for s in sr:
                    c = s.get("code")
                    if isinstance(c, str):
                        snap_by_code[c] = s

    # 3) Split into per-side {strike, delta, iv-as-decimal} rows. moomoo's
    # option_implied_volatility comes back as a percentage (32.5 = 32.5%);
    # divide by 100 so everything in the response is on the same decimal scale
    # as HV.
    calls: list[dict] = []
    puts: list[dict] = []
    for r in chain_rows:
        c = r.get("code")
        if not isinstance(c, str):
            continue
        s = snap_by_code.get(c, {})
        iv_pct = _f(s.get("option_implied_volatility"))
        d = _f(s.get("option_delta"))
        strike = _f(r.get("strike_price"))
        if iv_pct is None or d is None or strike is None or iv_pct <= 0:
            continue
        entry = {"strike": strike, "delta": d, "iv": iv_pct / 100.0}
        side = str(r.get("option_type", "")).upper()
        if side == "CALL":
            calls.append(entry)
        elif side == "PUT":
            puts.append(entry)

    # ATM IV — strike closest to spot, separately per side, then averaged.
    atm_call = _nearest(calls, "strike", spot)
    atm_put = _nearest(puts, "strike", spot)
    atm_iv_call = atm_call["iv"] if atm_call else None
    atm_iv_put = atm_put["iv"] if atm_put else None
    if atm_iv_call is not None and atm_iv_put is not None:
        atm_iv: float | None = (atm_iv_call + atm_iv_put) / 2.0
    else:
        atm_iv = atm_iv_call if atm_iv_call is not None else atm_iv_put

    # 25Δ risk reversal: put IV at Δ≈-0.25 minus call IV at Δ≈+0.25. Positive
    # = put-side premium (downside protection priced up); negative = call-side
    # premium (rare; often signals melt-up positioning).
    p25 = _nearest(puts, "delta", -0.25)
    c25 = _nearest(calls, "delta", 0.25)
    skew_25d = (p25["iv"] - c25["iv"]) if (p25 and c25) else None

    iv_hv_ratio = (atm_iv / hv_30) if (atm_iv is not None and hv_30 and hv_30 > 0) else None

    return {
        "symbol": symbol,
        "yfTicker": yf_ticker,
        "spot": spot,
        "expiry_used": expiry_iso,
        "dte": dte,
        "atm_iv": atm_iv,
        "atm_iv_call": atm_iv_call,
        "atm_iv_put": atm_iv_put,
        "atm_strike_call": atm_call["strike"] if atm_call else None,
        "atm_strike_put": atm_put["strike"] if atm_put else None,
        "hv_30": hv_30,
        "hv_60": hv_60,
        "iv_hv_ratio": iv_hv_ratio,
        "skew_25d": skew_25d,
        "skew_25d_call_strike": c25["strike"] if c25 else None,
        "skew_25d_put_strike": p25["strike"] if p25 else None,
        "hv_sample_size": max(0, len(closes) - 1),
    }


# ---------------------------------------------------------------------------
# Price-action / breakdown signal — the "falling-knife guard" input.
#
# Deterministic, computed from daily OHLCV. The synthesis layer (synth.ts) uses
# `signal` to HARD-VETO the wrong-side credit trade: a confirmed "breakdown"
# forbids selling put spreads / CSPs (don't catch the knife); a confirmed
# "breakout" forbids selling call spreads / covered calls (don't fade a melt-up).
# Thresholds below are tunable constants — keep them named so they're auditable.
# ---------------------------------------------------------------------------

# Breakdown confirmation (downside).
_BRK_DRAWDOWN_PCT = 10.0      # % off the 20-day high that counts as "broken down"
_BRK_VOL_RATIO = 1.5          # today volume / 20d avg that counts as "heavy volume"
_BRK_GAP_PCT = 3.0            # |gap %| (open vs prior close) that counts as a gap move
_BRK_RUN_DAYS = 3             # consecutive same-direction days that counts as a run
_BRK_NEAR_EXTREME_PCT = 1.0   # within this % of the 20d low/high == "at the extreme"
# Severe escalation.
_BRK_SEVERE_GAP_PCT = 5.0
_BRK_SEVERE_VOL_RATIO = 2.0


def _fetch_daily_ohlcv(yf_ticker: str, n_bars: int = 220) -> list[dict]:
    """Most recent N daily OHLCV bars (ascending). Cached once per calendar day
    per ticker in SQLite, same discipline as _fetch_daily_closes. 220 bars so a
    200-day SMA is computable with headroom. Returns [] on failure (never raises
    — the price-action signal degrades to 'none', it must not break the verdict)."""
    today_iso = dt.date.today().isoformat()

    with _db() as conn:
        row = conn.execute(
            "SELECT last_refresh_date FROM daily_ohlcv_sync WHERE yf_ticker = ?",
            (yf_ticker,),
        ).fetchone()
        if row and row[0] == today_iso:
            rows = conn.execute(
                "SELECT bar_date, open, high, low, close, volume FROM daily_ohlcv "
                "WHERE yf_ticker = ? ORDER BY bar_date DESC LIMIT ?",
                (yf_ticker, n_bars),
            ).fetchall()
            if len(rows) >= 30:
                return [
                    {"date": r[0], "open": r[1], "high": r[2], "low": r[3],
                     "close": r[4], "volume": r[5]}
                    for r in reversed(rows)
                ]

    try:
        import yfinance as yf  # lazy import — already used elsewhere
        period_days = max(n_bars * 2, 320)
        t = yf.Ticker(yf_ticker)
        hist = t.history(period=f"{period_days}d", interval="1d", auto_adjust=False)
    except Exception:
        return []
    if hist is None or hist.empty or "Close" not in hist:
        return []

    bars: list[dict] = []
    for ts, r in hist.iterrows():
        o, h, l, c, v = (r.get("Open"), r.get("High"), r.get("Low"),
                         r.get("Close"), r.get("Volume"))
        vals = [_f(o), _f(h), _f(l), _f(c)]
        if any(x is None for x in vals):
            continue
        bars.append({
            "date": ts.strftime("%Y-%m-%d"),
            "open": vals[0], "high": vals[1], "low": vals[2], "close": vals[3],
            "volume": _f(v) or 0.0,
        })
    if not bars:
        return []
    bars = bars[-n_bars:]

    with _db() as conn:
        with conn:
            conn.executemany(
                "INSERT OR REPLACE INTO daily_ohlcv "
                "(yf_ticker, bar_date, open, high, low, close, volume) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(yf_ticker, b["date"], b["open"], b["high"], b["low"],
                  b["close"], b["volume"]) for b in bars],
            )
            conn.execute(
                "INSERT OR REPLACE INTO daily_ohlcv_sync "
                "(yf_ticker, last_refresh_date, bars_count) VALUES (?, ?, ?)",
                (yf_ticker, today_iso, len(bars)),
            )
    return bars


def _sma(closes: list[float], window: int) -> float | None:
    if len(closes) < window:
        return None
    return sum(closes[-window:]) / window


def _run_length(closes: list[float], direction: int) -> int:
    """Consecutive trailing days moving in `direction` (+1 up, -1 down),
    counting close-to-close changes from the most recent bar backwards."""
    run = 0
    for i in range(len(closes) - 1, 0, -1):
        diff = closes[i] - closes[i - 1]
        if direction > 0 and diff > 0:
            run += 1
        elif direction < 0 and diff < 0:
            run += 1
        else:
            break
    return run


@app.get("/price-action")
def price_action(symbol: str = Query(..., description="e.g. US.AAPL")):
    """Deterministic price-action breakdown/breakout signal for the verdict's
    falling-knife guard. Returns signal='none' (and 200 OK) whenever data is
    thin or absent — callers treat null/none as 'no guard', never an error."""
    yf_ticker = _to_yf_ticker(symbol)
    bars = _fetch_daily_ohlcv(yf_ticker, n_bars=220)

    base = {
        "symbol": symbol, "yfTicker": yf_ticker, "signal": "none",
        "severity": "none", "reasons": [], "spot": None,
        "sma50": None, "sma200": None, "pctVsSma50": None, "pctVsSma200": None,
        "pctOffHigh20": None, "atLow20": False, "atHigh20": False,
        "consecutiveDownDays": 0, "consecutiveUpDays": 0,
        "todayChangePct": None, "gapPct": None, "volRatio": None,
        "hv30": None, "hv60": None, "hvExpansion": None, "barsUsed": len(bars),
    }
    if len(bars) < 30:
        return base

    closes = [b["close"] for b in bars]
    vols = [b["volume"] for b in bars]
    spot = closes[-1]
    prev_close = closes[-2]
    today_open = bars[-1]["open"]

    sma50 = _sma(closes, 50)
    sma200 = _sma(closes, 200)
    window20 = closes[-20:]
    high20 = max(window20)
    low20 = min(window20)
    avg_vol20 = sum(vols[-20:]) / min(20, len(vols)) if vols else 0.0

    pct_vs_50 = ((spot - sma50) / sma50 * 100) if sma50 else None
    pct_vs_200 = ((spot - sma200) / sma200 * 100) if sma200 else None
    pct_off_high20 = ((spot - high20) / high20 * 100) if high20 else None  # <= 0
    at_low20 = bool(low20 > 0 and (spot - low20) / low20 * 100 <= _BRK_NEAR_EXTREME_PCT)
    at_high20 = bool(high20 > 0 and (high20 - spot) / high20 * 100 <= _BRK_NEAR_EXTREME_PCT)
    down_run = _run_length(closes, -1)
    up_run = _run_length(closes, +1)
    today_chg = ((spot - prev_close) / prev_close * 100) if prev_close else None
    gap_pct = ((today_open - prev_close) / prev_close * 100) if prev_close else None
    vol_ratio = (vols[-1] / avg_vol20) if avg_vol20 > 0 else None
    hv30 = _compute_hv(closes, 30)
    hv60 = _compute_hv(closes, 60)
    hv_expansion = (hv30 / hv60) if (hv30 and hv60 and hv60 > 0) else None

    below_50 = pct_vs_50 is not None and pct_vs_50 < 0
    above_50 = pct_vs_50 is not None and pct_vs_50 > 0
    below_200 = pct_vs_200 is not None and pct_vs_200 < 0
    heavy_vol = vol_ratio is not None and vol_ratio >= _BRK_VOL_RATIO
    gap_down = gap_pct is not None and gap_pct <= -_BRK_GAP_PCT
    gap_up = gap_pct is not None and gap_pct >= _BRK_GAP_PCT
    deep_drawdown = pct_off_high20 is not None and pct_off_high20 <= -_BRK_DRAWDOWN_PCT

    reasons: list[str] = []
    signal = "none"
    severity = "none"

    # Downside breakdown: in a downtrend (below 50d), at/near lows or deeply off
    # the recent high, AND confirmed by heavy volume / a gap-down / a down-run.
    if below_50 and (at_low20 or deep_drawdown) and (heavy_vol or gap_down or down_run >= _BRK_RUN_DAYS):
        signal = "breakdown"
        if below_50:
            reasons.append(f"{abs(pct_vs_50):.1f}% below 50d MA")
        if below_200:
            reasons.append(f"{abs(pct_vs_200):.1f}% below 200d MA")
        if deep_drawdown:
            reasons.append(f"{abs(pct_off_high20):.1f}% off 20d high")
        elif at_low20:
            reasons.append("at 20-day lows")
        if heavy_vol:
            reasons.append(f"volume {vol_ratio:.1f}x 20d avg")
        if gap_down:
            reasons.append(f"gap-down {gap_pct:.1f}%")
        if down_run >= _BRK_RUN_DAYS:
            reasons.append(f"{down_run} consecutive down days")
        severe = below_200 and (
            (gap_pct is not None and gap_pct <= -_BRK_SEVERE_GAP_PCT)
            or (vol_ratio is not None and vol_ratio >= _BRK_SEVERE_VOL_RATIO)
        )
        severity = "severe" if severe else "mild"

    # Upside melt-up (mirror): above 50d, at/near 20d highs, confirmed by heavy
    # volume / gap-up / up-run.
    elif above_50 and at_high20 and (heavy_vol or gap_up or up_run >= _BRK_RUN_DAYS):
        signal = "breakout"
        reasons.append("at 20-day highs")
        if pct_vs_50 is not None:
            reasons.append(f"{pct_vs_50:.1f}% above 50d MA")
        if heavy_vol:
            reasons.append(f"volume {vol_ratio:.1f}x 20d avg")
        if gap_up:
            reasons.append(f"gap-up {gap_pct:.1f}%")
        if up_run >= _BRK_RUN_DAYS:
            reasons.append(f"{up_run} consecutive up days")
        severity = "mild"

    return {
        "symbol": symbol, "yfTicker": yf_ticker, "signal": signal,
        "severity": severity, "reasons": reasons,
        "spot": spot, "sma50": sma50, "sma200": sma200,
        "pctVsSma50": pct_vs_50, "pctVsSma200": pct_vs_200,
        "pctOffHigh20": pct_off_high20, "atLow20": at_low20, "atHigh20": at_high20,
        "consecutiveDownDays": down_run, "consecutiveUpDays": up_run,
        "todayChangePct": today_chg, "gapPct": gap_pct, "volRatio": vol_ratio,
        "hv30": hv30, "hv60": hv60, "hvExpansion": hv_expansion,
        "barsUsed": len(bars),
    }


# ---- Technical indicator VALUES (standing state, not anomaly events) ---------
# get_technical_unusual only fires on fresh EVENTS inside the window (a cross, a
# threshold breach). It is blind to a STANDING state like "RSI has been > 70 for
# weeks". This endpoint computes the current indicator readings directly from the
# cached daily OHLCV so the technical panel can show "currently overbought" even
# when no fresh anomaly tripped. Deterministic — never routed through the LLM.

def _ema(values: list[float], span: int) -> list[float]:
    """Standard EMA, seeded with the first value. Returns same-length series."""
    if not values:
        return []
    k = 2 / (span + 1)
    e = values[0]
    out = [e]
    for v in values[1:]:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def _rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder's RSI. None if fewer than period+1 closes."""
    if len(closes) < period + 1:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def _macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    """Returns (macd_line, signal_line, histogram) at the latest bar, or
    (None, None, None) if there aren't enough bars for the slow EMA + signal."""
    if len(closes) < slow + signal:
        return None, None, None
    macd_series = [f - s for f, s in zip(_ema(closes, fast), _ema(closes, slow))]
    sig_series = _ema(macd_series, signal)
    macd_v = macd_series[-1]
    sig_v = sig_series[-1]
    return macd_v, sig_v, macd_v - sig_v


def _bbands(closes: list[float], window: int = 20, k: float = 2.0):
    """Bollinger bands (upper, mid, lower, %B) at the latest bar. %B = where spot
    sits across the band: >1 above upper, <0 below lower. Population stddev."""
    if len(closes) < window:
        return None, None, None, None
    w = closes[-window:]
    mid = sum(w) / window
    var = sum((x - mid) ** 2 for x in w) / window
    sd = math.sqrt(var)
    upper = mid + k * sd
    lower = mid - k * sd
    pct_b = ((closes[-1] - lower) / (upper - lower)) if upper > lower else None
    return upper, mid, lower, pct_b


def _adx(highs: list[float], lows: list[float], closes: list[float], period: int = 14):
    """Wilder's ADX(period) plus the latest +DI / -DI. Returns (adx, plus_di,
    minus_di) at the most recent bar, or (None, None, None) if there aren't
    enough bars. ADX measures TREND STRENGTH irrespective of direction; +DI/-DI
    carry the direction. The verdict's regime gate keys off these: high ADX = a
    trend you should NOT fade on an oscillator; low ADX = a range where
    overbought/oversold mean-reversion actually works."""
    n = len(closes)
    if n < 2 * period + 1:
        return None, None, None
    trs: list[float] = []
    plus_dm: list[float] = []
    minus_dm: list[float] = []
    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm.append(up if (up > down and up > 0) else 0.0)
        minus_dm.append(down if (down > up and down > 0) else 0.0)
        trs.append(max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        ))
    # Wilder-smoothed TR / +DM / -DM, then a DX series, then Wilder-smoothed ADX.
    atr = sum(trs[:period])
    sp_dm = sum(plus_dm[:period])
    sm_dm = sum(minus_dm[:period])
    dxs: list[float] = []
    plus_di = minus_di = 0.0
    for i in range(period, len(trs)):
        atr = atr - atr / period + trs[i]
        sp_dm = sp_dm - sp_dm / period + plus_dm[i]
        sm_dm = sm_dm - sm_dm / period + minus_dm[i]
        if atr == 0:
            continue
        plus_di = 100 * sp_dm / atr
        minus_di = 100 * sm_dm / atr
        denom = plus_di + minus_di
        dxs.append(100 * abs(plus_di - minus_di) / denom if denom else 0.0)
    if len(dxs) < period:
        return None, None, None
    adx = sum(dxs[:period]) / period
    for i in range(period, len(dxs)):
        adx = (adx * (period - 1) + dxs[i]) / period
    return adx, plus_di, minus_di


def _rsi_series(closes: list[float], period: int = 14) -> list[float | None]:
    """Wilder RSI at every bar (None for the leading bars without enough data).
    Index-aligned to `closes` so divergence detection can read RSI at a price
    pivot's bar index."""
    n = len(closes)
    out: list[float | None] = [None] * n
    if n < period + 1:
        return out
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, n):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))

    def rsi_from(ag: float, al: float) -> float:
        if al == 0:
            return 100.0
        return 100 - 100 / (1 + ag / al)

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    out[period] = rsi_from(avg_gain, avg_loss)
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = rsi_from(avg_gain, avg_loss)
    return out


def _pivot_indices(values: list[float | None], left: int, right: int, kind: str) -> list[int]:
    """Indices of local price extrema (swing highs/lows) with `left` bars lower
    on the left and `right` lower on the right. A bar needs `right` confirming
    bars after it, so the newest detectable pivot is `right` bars old."""
    out: list[int] = []
    n = len(values)
    for i in range(left, n - right):
        v = values[i]
        if v is None:
            continue
        window = values[i - left:i + right + 1]
        if any(w is None for w in window):
            continue
        if kind == "high" and v >= max(window) and v > min(window):
            out.append(i)
        elif kind == "low" and v <= min(window) and v < max(window):
            out.append(i)
    return out


def _rsi_divergence(closes: list[float], rsi: list[float | None],
                    lookback: int = 60, left: int = 3, right: int = 3) -> str:
    """Classic regular RSI divergence over the last `lookback` bars.
    - "bearish": price prints a HIGHER swing high while RSI prints a LOWER high
      (momentum fading under a rising price — the real 'overbought is now
      exhausting' tell, vs. a bare overbought reading that means nothing).
    - "bullish": price prints a LOWER swing low while RSI prints a HIGHER low
      (selling pressure fading under a falling price — the mirror that flags an
      oversold DOWNTREND finally turning, vs. an oversold name that just keeps
      bleeding).
    - "none": no qualifying two-pivot pattern. Requires the most recent pivot to
      be within `lookback` bars and the two pivots ≥ 5 bars apart."""
    n = len(closes)
    if n < lookback // 2:
        return "none"
    start = max(0, n - lookback)

    highs = [i for i in _pivot_indices([c for c in closes], left, right, "high") if i >= start]
    if len(highs) >= 2:
        a, b = highs[-2], highs[-1]
        if b - a >= 5 and rsi[a] is not None and rsi[b] is not None:
            if closes[b] > closes[a] and rsi[b] < rsi[a]:
                return "bearish"

    lows = [i for i in _pivot_indices([c for c in closes], left, right, "low") if i >= start]
    if len(lows) >= 2:
        a, b = lows[-2], lows[-1]
        if b - a >= 5 and rsi[a] is not None and rsi[b] is not None:
            if closes[b] < closes[a] and rsi[b] > rsi[a]:
                return "bullish"

    return "none"


def _regime(adx: float | None, plus_di: float | None, minus_di: float | None,
            spot: float, sma50: float | None, sma200: float | None) -> str:
    """Classify the trend regime so the verdict knows whether an overbought/
    oversold oscillator reading is actionable (range) or a trap to fade (trend).
    ADX sets strength; +DI/-DI and the SMA stack set direction.
    Returns: strong_uptrend | uptrend | range | downtrend | strong_downtrend | n/a."""
    if adx is None:
        return "n/a"
    # Direction: lean on DI cross, confirm with the 50/200 SMA stack.
    up_votes = 0
    down_votes = 0
    if plus_di is not None and minus_di is not None:
        if plus_di > minus_di:
            up_votes += 1
        elif minus_di > plus_di:
            down_votes += 1
    if sma50 is not None:
        if spot > sma50:
            up_votes += 1
        else:
            down_votes += 1
    if sma200 is not None:
        if spot > sma200:
            up_votes += 1
        else:
            down_votes += 1
    up = up_votes >= down_votes
    if adx < 20:
        return "range"
    strong = adx >= 35
    if up:
        return "strong_uptrend" if strong else "uptrend"
    return "strong_downtrend" if strong else "downtrend"


def _atr(highs: list[float], lows: list[float], closes: list[float],
         period: int = 14) -> float | None:
    """Wilder's ATR(period) at the latest bar — the average true range, used as
    the clustering tolerance for support/resistance zones (so 'nearby' scales
    with the stock's own daily range, not a flat %). None if too few bars."""
    if len(closes) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def _swing_pivots(highs: list[float], lows: list[float], k: int = 3):
    """Fractal swing pivots. Bar i is a pivot-high if its high is the strict
    maximum of the 2k+1-bar window centered on it (inverted for pivot-lows). The
    most recent k bars are unconfirmed (no right-hand window yet) and excluded.
    Returns (pivot_highs, pivot_lows), each a list of (index, price) ascending by
    index — the raw swings that S/R clustering and structure detection consume."""
    n = len(highs)
    ph: list[tuple[int, float]] = []
    pl: list[tuple[int, float]] = []
    for i in range(k, n - k):
        win_h = highs[i - k:i + k + 1]
        win_l = lows[i - k:i + k + 1]
        if highs[i] == max(win_h) and win_h.count(highs[i]) == 1:
            ph.append((i, highs[i]))
        if lows[i] == min(win_l) and win_l.count(lows[i]) == 1:
            pl.append((i, lows[i]))
    return ph, pl


def _cluster_levels(pivots: list[tuple[int, float]], tol: float) -> list[dict]:
    """Merge pivots whose prices sit within `tol` (absolute, ~1 ATR) into zones.
    A level retested several times is stronger than a one-off wick, so each zone
    carries a touch count; its price is the touch-mean, and lastIdx is the most
    recent touch (for recency weighting). Returns zones ascending by price."""
    if not pivots or tol <= 0:
        return []
    pts = sorted(pivots, key=lambda p: p[1])
    clusters: list[list[tuple[int, float]]] = [[pts[0]]]
    for idx, price in pts[1:]:
        if price - clusters[-1][-1][1] <= tol:
            clusters[-1].append((idx, price))
        else:
            clusters.append([(idx, price)])
    zones = [
        {
            "price": sum(p[1] for p in c) / len(c),
            "touches": len(c),
            "lastIdx": max(p[0] for p in c),
        }
        for c in clusters
    ]
    zones.sort(key=lambda z: z["price"])
    return zones


def _market_structure(closes: list[float], pivot_highs: list[tuple[int, float]],
                      pivot_lows: list[tuple[int, float]]):
    """Swing-structure bias plus the latest break. Bias reads the last two pivot
    highs and lows: higher-high + higher-low = up, lower-high + lower-low = down,
    otherwise range. A BREAK fires when the latest close clears the most recent
    confirmed pivot: in the SAME direction as the prior bias it's a BOS (break of
    structure, continuation); AGAINST it (or out of a range) it's a CHoCH (change
    of character, the first tell of a reversal). Returns
    (bias, event, direction, level)."""
    bias = "range"
    if len(pivot_highs) >= 2 and len(pivot_lows) >= 2:
        hh = pivot_highs[-1][1] > pivot_highs[-2][1]
        hl = pivot_lows[-1][1] > pivot_lows[-2][1]
        if hh and hl:
            bias = "up"
        elif not hh and not hl:
            bias = "down"

    spot = closes[-1]
    event, direction, level = "none", "n/a", None
    last_ph = pivot_highs[-1] if pivot_highs else None
    last_pl = pivot_lows[-1] if pivot_lows else None
    if last_ph and spot > last_ph[1]:
        direction, level = "up", last_ph[1]
        event = "BOS" if bias == "up" else "CHoCH"
    elif last_pl and spot < last_pl[1]:
        direction, level = "down", last_pl[1]
        event = "BOS" if bias == "down" else "CHoCH"
    return bias, event, direction, level


def _levels(highs: list[float], lows: list[float], closes: list[float]) -> dict:
    """Assemble the support/resistance + market-structure block from swing pivots.
    Support/resistance zones are the clustered pivots split by side of spot
    (nearest first); a former resistance now below price counts as support, so
    highs and lows are pooled before splitting. All keys are present and null when
    bars are thin — this rides into /technical/indicators, it must never raise."""
    out = {
        "support": None, "resistance": None,
        "supportLevels": [], "resistanceLevels": [],
        "structureBias": "n/a", "structureEvent": "none",
        "structureDirection": "n/a", "structureLevel": None,
    }
    if len(closes) < 40:
        return out
    spot = closes[-1]
    atr = _atr(highs, lows, closes, 14)
    tol = atr if atr and atr > 0 else spot * 0.015
    ph, pl = _swing_pivots(highs, lows, k=3)
    zones = _cluster_levels(ph + pl, tol)
    supports = sorted([z for z in zones if z["price"] < spot],
                      key=lambda z: -z["price"])   # nearest below first
    resistances = sorted([z for z in zones if z["price"] > spot],
                         key=lambda z: z["price"])  # nearest above first
    bias, event, direction, level = _market_structure(closes, ph, pl)
    out["support"] = round(supports[0]["price"], 2) if supports else None
    out["resistance"] = round(resistances[0]["price"], 2) if resistances else None
    out["supportLevels"] = [round(z["price"], 2) for z in supports[:3]]
    out["resistanceLevels"] = [round(z["price"], 2) for z in resistances[:3]]
    out["structureBias"] = bias
    out["structureEvent"] = event
    out["structureDirection"] = direction
    out["structureLevel"] = round(level, 2) if level is not None else None
    return out


@app.get("/technical/indicators")
def technical_indicators(symbol: str = Query(..., description="e.g. US.MU")):
    """Current technical-indicator readings (RSI/MACD/Bollinger/SMA distances)
    from cached daily OHLCV. Complements /anomaly/technical: that one reports
    fresh anomaly EVENTS, this one reports the standing STATE. Returns 200 with
    nulls when data is thin (never raises — a missing indicator must not break
    the panel)."""
    yf_ticker = _to_yf_ticker(symbol)
    bars = _fetch_daily_ohlcv(yf_ticker, n_bars=260)

    base = {
        "symbol": symbol, "yfTicker": yf_ticker, "spot": None, "asOf": None,
        "barsUsed": len(bars),
        "rsi14": None, "rsiState": "n/a",
        "macd": None, "macdSignal": None, "macdHist": None,
        "bbUpper": None, "bbMid": None, "bbLower": None, "bbPctB": None,
        "sma20": None, "sma50": None, "sma200": None,
        "pctVsSma20": None, "pctVsSma50": None, "pctVsSma200": None,
        "high52w": None, "low52w": None, "pctOff52wHigh": None,
        "ret5d": None, "ret20d": None,
        "adx14": None, "plusDi": None, "minusDi": None,
        "regime": "n/a", "rsiDivergence": "none",
        "support": None, "resistance": None,
        "supportLevels": [], "resistanceLevels": [],
        "structureBias": "n/a", "structureEvent": "none",
        "structureDirection": "n/a", "structureLevel": None,
    }
    if len(bars) < 15:
        return base

    closes = [b["close"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    spot = closes[-1]

    def pct_vs(ma):
        return ((spot - ma) / ma * 100) if ma else None

    rsi = _rsi(closes, 14)
    macd_v, sig_v, hist = _macd(closes)
    bb_u, bb_m, bb_l, bb_pctb = _bbands(closes, 20, 2.0)
    sma20, sma50, sma200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
    adx, plus_di, minus_di = _adx(highs, lows, closes, 14)
    regime = _regime(adx, plus_di, minus_di, spot, sma50, sma200)
    divergence = _rsi_divergence(closes, _rsi_series(closes, 14))
    hi = max(closes)
    lo = min(closes)
    rsi_state = (
        "overbought" if (rsi is not None and rsi >= 70)
        else "oversold" if (rsi is not None and rsi <= 30)
        else "neutral" if rsi is not None else "n/a"
    )

    def rnd(x, d=2):
        return None if x is None else round(x, d)

    levels = _levels(highs, lows, closes)

    return {
        "symbol": symbol, "yfTicker": yf_ticker, "spot": rnd(spot), "asOf": bars[-1]["date"],
        "barsUsed": len(bars),
        "rsi14": rnd(rsi, 1), "rsiState": rsi_state,
        "macd": rnd(macd_v), "macdSignal": rnd(sig_v), "macdHist": rnd(hist),
        "bbUpper": rnd(bb_u), "bbMid": rnd(bb_m), "bbLower": rnd(bb_l), "bbPctB": rnd(bb_pctb, 3),
        "sma20": rnd(sma20), "sma50": rnd(sma50), "sma200": rnd(sma200),
        "pctVsSma20": rnd(pct_vs(sma20), 1), "pctVsSma50": rnd(pct_vs(sma50), 1),
        "pctVsSma200": rnd(pct_vs(sma200), 1),
        "high52w": rnd(hi), "low52w": rnd(lo),
        "pctOff52wHigh": rnd((spot - hi) / hi * 100, 1) if hi else None,
        "ret5d": rnd((spot / closes[-6] - 1) * 100, 1) if len(closes) >= 6 else None,
        "ret20d": rnd((spot / closes[-21] - 1) * 100, 1) if len(closes) >= 21 else None,
        "adx14": rnd(adx, 1), "plusDi": rnd(plus_di, 1), "minusDi": rnd(minus_di, 1),
        "regime": regime, "rsiDivergence": divergence,
        **levels,
    }


# ---- Morningstar research report (replaces the moomoo news flow as the News --
# Flow panel's self-signal). OpenD's get_research_morningstar_report carries the
# forward-looking analyst view (fair value, economic moat, uncertainty, bull/bear
# case, capital allocation, the latest analyst note) that the trailing yfinance
# fundamentals snapshot and the recency-sorted news search both miss. Requires
# moomoo-api >= 10.5; rate-limited to 30 req / 30s; common stocks + REITs only.
# Never raises — returns {available: False} so the panel degrades to "n/a".
@app.get("/research/morningstar")
def research_morningstar(symbol: str = Query(..., description="e.g. US.META")):
    try:
        with quote_ctx() as ctx:
            ret, data = ctx.get_research_morningstar_report(symbol)
    except Exception as exc:  # SDK too old, OpenD down, etc.
        return {"symbol": symbol, "available": False, "error": str(exc)[:300]}
    if ret != RET_OK:
        # err_code path (no report for this code, unsupported asset, rate limit)
        return {"symbol": symbol, "available": False, "error": str(data)[:300]}
    rec = _normalize(data)
    if isinstance(rec, list):
        rec = rec[0] if rec else {}
    if not isinstance(rec, dict) or not rec:
        return {"symbol": symbol, "available": False, "error": "empty report"}
    return {"symbol": symbol, "available": True, "report": rec}


