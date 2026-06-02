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
    return _call("get_financial_unusual", symbol, time_range, _split(dimensions), language_id)


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
    return _call("get_derivative_unusual", symbol, time_range, _split(dimensions), language_id)


# ---- Options ----------------------------------------------------------------
# Moomoo Lv1 (real-time OPRA on US options) covers everything below:
# - get_option_expiration_date → expiry list
# - get_option_chain(start, end) → strike ladder across a date window
# - get_market_snapshot([opt_codes]) → bid/ask/last/IV/greeks/OI in one shot
# No polling, no chunking, no rate-limit dance — the IBKR options module this
# replaces was 540 lines of mitigations for snapshot quirks that don't exist
# here.


@app.get("/options/expiries")
def option_expiries(symbol: str = Query(..., description="e.g. US.AAPL")):
    with quote_ctx() as ctx:
        ret, data = ctx.get_option_expiration_date(code=symbol)
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"get_option_expiration_date: {data}")
    return {"symbol": symbol, "data": _normalize(data)}


def _option_type_enum(s: str | None):
    if not s:
        return OptionType.ALL
    s = s.upper()
    if s == "CALL" or s == "C":
        return OptionType.CALL
    if s == "PUT" or s == "P":
        return OptionType.PUT
    return OptionType.ALL


@app.get("/options/chain")
def option_chain(
    symbol: str = Query(..., description="e.g. US.AAPL"),
    start: str = Query(..., description="ISO date, e.g. 2026-06-10"),
    end: str = Query(..., description="ISO date, e.g. 2026-07-17"),
    option_type: str | None = Query(default=None, description="CALL|PUT|ALL"),
    min_strike: float | None = None,
    max_strike: float | None = None,
    include_snapshot: bool = True,
):
    with quote_ctx() as ctx:
        ret, chain = ctx.get_option_chain(
            code=symbol,
            start=start,
            end=end,
            option_type=_option_type_enum(option_type),
        )
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_option_chain: {chain}")
        rows = _normalize(chain) if chain is not None else []
        if not isinstance(rows, list):
            rows = []
        if min_strike is not None:
            rows = [r for r in rows if isinstance(r.get("strike_price"), (int, float)) and r["strike_price"] >= min_strike]
        if max_strike is not None:
            rows = [r for r in rows if isinstance(r.get("strike_price"), (int, float)) and r["strike_price"] <= max_strike]

        snap_by_code: dict[str, dict] = {}
        if include_snapshot and rows:
            codes = [r["code"] for r in rows if isinstance(r.get("code"), str)]
            # Moomoo's snapshot endpoint accepts up to ~400 codes per call in
            # practice. Narrow chains (±25% strikes × a few expiries) sit well
            # under that; chunk defensively anyway.
            CHUNK = 200
            for i in range(0, len(codes), CHUNK):
                batch = codes[i : i + CHUNK]
                ret, snap = ctx.get_market_snapshot(batch)
                if ret != RET_OK:
                    raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap}")
                snap_rows = _normalize(snap) if snap is not None else []
                if isinstance(snap_rows, list):
                    for s in snap_rows:
                        c = s.get("code")
                        if isinstance(c, str):
                            snap_by_code[c] = s

    contracts = []
    for r in rows:
        code = r.get("code")
        s = snap_by_code.get(code, {}) if isinstance(code, str) else {}
        contracts.append({
            "code": code,
            "name": r.get("name"),
            "strike": r.get("strike_price"),
            "side": "C" if str(r.get("option_type", "")).upper() == "CALL" else "P",
            "expiry": r.get("strike_time"),
            "lot_size": r.get("lot_size"),
            "expiration_cycle": r.get("expiration_cycle"),
            # Snapshot fields — present when include_snapshot=true and snapshot succeeded.
            "last_price": s.get("last_price"),
            "bid_price": s.get("bid_price"),
            "ask_price": s.get("ask_price"),
            "volume": s.get("volume"),
            "open_interest": s.get("option_open_interest"),
            "implied_volatility": s.get("option_implied_volatility"),
            "delta": s.get("option_delta"),
            "gamma": s.get("option_gamma"),
            "vega": s.get("option_vega"),
            "theta": s.get("option_theta"),
            "rho": s.get("option_rho"),
            "update_time": s.get("update_time"),
        })

    return {"symbol": symbol, "start": start, "end": end, "contracts": contracts}


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
    # whole request — same pattern as /options/chain.
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


