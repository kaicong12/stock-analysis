"""Underlying quotes and the sector peer graph."""

from fastapi import APIRouter, HTTPException, Query
from moomoo import RET_OK

from config import PEERS_MIN_CAP, PEERS_MIN_PRICE
from opend import quote_ctx
from util import normalize

router = APIRouter()


@router.get("/snapshot")
def snapshot(symbol: str = Query(..., description="e.g. US.AAPL")):
    with quote_ctx() as ctx:
        ret, data = ctx.get_market_snapshot([symbol])
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"get_market_snapshot: {data}")
    rows = normalize(data)
    return {"symbol": symbol, "data": rows[0] if isinstance(rows, list) and rows else rows}


@router.get("/peers/{symbol}")
def peers(symbol: str, top: int = 8):
    """Large-cap sector peers from the ticker's INDUSTRY plate.

    Membership barely moves, and get_owner_plate / get_plate_stock are limited
    to 10 req / 30s, so callers should cache this for ~a day.
    """
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

        ret, snap = ctx.get_market_snapshot(codes)
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap}")

    out = []
    for s in normalize(snap):
        if s.get("code") == symbol:
            continue
        cap = s.get("total_market_val") or 0
        price = s.get("last_price") or 0
        if cap >= PEERS_MIN_CAP and price >= PEERS_MIN_PRICE:
            out.append({"code": s["code"], "name": s.get("name"),
                        "capBn": round(cap / 1e9, 1), "price": price})
    out.sort(key=lambda x: x["capBn"], reverse=True)
    return {"symbol": symbol, "industryPlate": plate["plate_name"], "peers": out[:top]}
