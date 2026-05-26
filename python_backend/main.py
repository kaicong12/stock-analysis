import math
import os
import threading
from contextlib import contextmanager
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


