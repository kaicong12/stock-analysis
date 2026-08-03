"""Payload coercion helpers shared across routers."""

import math
from typing import Any


def normalize(value: Any) -> Any:
    """Make an SDK payload JSON-safe: DataFrames to records, NaN/Inf to None."""
    if hasattr(value, "to_dict"):
        try:
            return normalize(value.to_dict(orient="records"))
        except TypeError:
            return normalize(value.to_dict())
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(v) for v in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def split_csv(values: list[str] | None) -> list[str] | None:
    """Flatten repeated and/or comma-joined query params into one list."""
    if not values:
        return None
    out: list[str] = []
    for v in values:
        for part in str(v).split(","):
            part = part.strip()
            if part:
                out.append(part)
    return out or None


def to_float(value: Any) -> float | None:
    """Float or None — never NaN/Inf, which are not valid JSON."""
    try:
        if value is None:
            return None
        f = float(value)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def to_yf_ticker(symbol: str) -> str:
    """moomoo MARKET.CODE -> yfinance ticker. HK codes need 4-digit padding."""
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
