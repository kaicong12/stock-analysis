"""Market tape for the daily digest. No moomoo import, so it survives OpenD being down."""

from fastapi import APIRouter

from bars import daily_ohlcv
from config import TAPE_BARS
from models import MarketTape
from tape_util import TAPE_SYMBOLS, VIX_KEY, quote_from_bars, vix_rank

router = APIRouter()


@router.get("/market/tape", response_model=MarketTape)
def market_tape() -> MarketTape:
    """Index, vol and energy closes. Always 200 — a bad feed nulls one row, never the digest."""
    quotes = []
    vix = None
    errors = []
    for key, yf_ticker, label in TAPE_SYMBOLS:
        try:
            bars = daily_ohlcv(yf_ticker, n_bars=TAPE_BARS)
        except Exception as exc:
            bars = []
            errors.append({"source": yf_ticker, "message": f"{type(exc).__name__}: {exc}"})
        quotes.append(quote_from_bars(key, label, yf_ticker, bars))
        if key == VIX_KEY:
            vix = vix_rank(bars)

    dates = [q["asOf"] for q in quotes if q["asOf"]]
    return MarketTape(
        asOf=max(dates) if dates else None,
        quotes=quotes,
        vix=vix,
        errors=errors,
    )
