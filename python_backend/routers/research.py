"""Morningstar research report — the News Flow panel's self-signal.

Carries the forward-looking analyst view (fair value, moat, uncertainty,
bull/bear case) that trailing fundamentals and recency-sorted news both miss.
Requires moomoo-api >= 10.5; 30 req / 30s; common stocks and REITs only.
Never raises — an unavailable report degrades the panel to "n/a".
"""

from fastapi import APIRouter, Query
from moomoo import RET_OK

from opend import quote_ctx
from util import normalize

router = APIRouter()


@router.get("/research/morningstar")
def research_morningstar(symbol: str = Query(..., description="e.g. US.META")):
    try:
        with quote_ctx() as ctx:
            ret, data = ctx.get_research_morningstar_report(symbol)
    except Exception as exc:  # SDK too old, OpenD down
        return {"symbol": symbol, "available": False, "error": str(exc)[:300]}
    if ret != RET_OK:  # no report, unsupported asset, or rate limited
        return {"symbol": symbol, "available": False, "error": str(data)[:300]}

    rec = normalize(data)
    if isinstance(rec, list):
        rec = rec[0] if rec else {}
    if not isinstance(rec, dict) or not rec:
        return {"symbol": symbol, "available": False, "error": "empty report"}
    return {"symbol": symbol, "available": True, "report": rec}
