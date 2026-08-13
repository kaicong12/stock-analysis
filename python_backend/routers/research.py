"""Morningstar research report — the News Flow panel's self-signal."""

from fastapi import APIRouter, Query
from moomoo import RET_OK

from models import MorningstarResponse
from opend import quote_ctx
from util import normalize

router = APIRouter()

# Requires moomoo-api >= 10.5; 30 req / 30s; common stocks and REITs only.


@router.get("/research/morningstar", response_model=MorningstarResponse,
            response_model_exclude_none=True)
def research_morningstar(symbol: str = Query(..., description="e.g. US.META")):
    """Morningstar report for one symbol; never raises, reports available=false instead."""
    try:
        with quote_ctx() as ctx:
            ret, data = ctx.get_research_morningstar_report(symbol)
    except Exception as exc:
        return {"symbol": symbol, "available": False, "error": str(exc)[:300]}
    if ret != RET_OK:
        return {"symbol": symbol, "available": False, "error": str(data)[:300]}

    rec = normalize(data)
    if isinstance(rec, list):
        rec = rec[0] if rec else {}
    if not isinstance(rec, dict) or not rec:
        return {"symbol": symbol, "available": False, "error": "empty report"}
    return {"symbol": symbol, "available": True, "report": rec}
