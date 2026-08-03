"""moomoo anomaly feeds (capital / technical / derivatives).

A request bundling several dimensions fails entirely if ANY one errors, and
moomoo returns -12301 (empty payload) for a number of dimensions on every
symbol we've tested — so a full scan always came back blank. Workaround: query
the working dimensions one at a time and merge the successes. To re-enable a
dimension once moomoo fixes it, just add it back to the list; a still-broken
entry degrades gracefully instead of blanking the panel.
"""

from fastapi import APIRouter, HTTPException, Query
from moomoo import RET_OK

from opend import quote_ctx
from util import normalize, split_csv

router = APIRouter(prefix="/anomaly")

FINANCIAL_DIMENSIONS: list[tuple[str, str]] = [
    ("funds_distribution", "Funds Distribution (资金分布)"),
    ("funds_broker", "Buy/Sell Brokers (买卖经纪商)"),
    # Broken (-12301): funds_flow, short_sell_number, short_sell_ratio,
    # short_sell_number_and_ratio.
]

DERIVATIVE_DIMENSIONS: list[tuple[str, str]] = [
    ("option_unusual", "Unusual Options Trades (期权大单)"),
    # Broken (-12301): option_volatility, option_volume_price, option_sentiment,
    # option_comprehensive. warrant_* are HK-only CBBC concepts, omitted.
]


def _call(method_name: str, symbol: str, time_range: int, dims: list[str] | None,
          language_id: int, dim_kwarg: str = "analysis_dimensions") -> dict:
    with quote_ctx() as ctx:
        method = getattr(ctx, method_name)
        ret, data = method(symbol, time_range=time_range,
                           language_id=language_id, **{dim_kwarg: dims})
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"{method_name}: {data}")
    return {
        "method": method_name,
        "symbol": symbol,
        "time_range": time_range,
        "language_id": language_id,
        "dimensions": dims or [],
        "data": normalize(data),
    }


def _dim_succeeded(err_code) -> bool:
    """0 = success with content, 1 = success/no-anomaly, <0 = error."""
    return isinstance(err_code, int) and err_code >= 0


def _merge_dimensions(method_name: str, symbol: str, time_range: int,
                      language_id: int, dimensions: list[tuple[str, str]]) -> dict:
    """Query each dimension separately and merge the successes. Mirrors _call's
    envelope so the TS caller keeps working unchanged; per_dimension is a
    diagnostic map of which dimensions errored."""
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
            rec = normalize(data)
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
        # Distinguish "no anomaly" from "data unavailable" for the panel.
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


@router.get("/capital")
def capital_anomaly(
    symbol: str = Query(..., description="e.g. US.AAPL"),
    time_range: int = 30,
    language_id: int = 2,
    dimensions: list[str] | None = Query(default=None),
):
    requested = split_csv(dimensions)
    dims = [(d, d) for d in requested] if requested else FINANCIAL_DIMENSIONS
    return _merge_dimensions("get_financial_unusual", symbol, time_range, language_id, dims)


@router.get("/technical")
def technical_anomaly(
    symbol: str = Query(...),
    time_range: int = 30,
    language_id: int = 2,
    indicators: list[str] | None = Query(default=None),
):
    return _call("get_technical_unusual", symbol, time_range, split_csv(indicators),
                 language_id, dim_kwarg="indicator_filters")


@router.get("/derivatives")
def derivatives_anomaly(
    symbol: str = Query(...),
    time_range: int = 30,
    language_id: int = 2,
    dimensions: list[str] | None = Query(default=None),
):
    requested = split_csv(dimensions)
    dims = [(d, d) for d in requested] if requested else DERIVATIVE_DIMENSIONS
    return _merge_dimensions("get_derivative_unusual", symbol, time_range, language_id, dims)
