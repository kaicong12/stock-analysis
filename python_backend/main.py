import math
import os
import threading
from contextlib import contextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from moomoo import OpenQuoteContext, RET_OK

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


