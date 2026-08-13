"""Market-tape math. Split from routers/tape.py so tests reach it without importing fastapi."""

from config import TAPE_RANK_MIN_SAMPLE, TAPE_RANK_WINDOW
from indicators import percentile_rank

TAPE_SYMBOLS = [
    ("sp500", "^GSPC", "S&P 500"),
    ("nasdaq", "^IXIC", "Nasdaq"),
    ("russell2000", "^RUT", "Russell 2000"),
    ("dow", "^DJI", "Dow"),
    ("vix", "^VIX", "VIX"),
    ("wti", "CL=F", "WTI Crude"),
]

VIX_KEY = "vix"


def _closes(bars: list[dict]) -> list[float]:
    """Closes from bars that have one."""
    return [b["close"] for b in bars if b.get("close") is not None]


def quote_from_bars(key: str, label: str, yf_ticker: str, bars: list[dict]) -> dict:
    """Builds one tape row; a single bar yields a level with a null change rather than no row."""
    closes = _closes(bars)
    last = closes[-1] if closes else None
    prev = closes[-2] if len(closes) >= 2 else None
    change_pct = None
    if last is not None and prev is not None and prev != 0:
        change_pct = round((last / prev - 1) * 100, 2)
    dated = [b["date"] for b in bars if b.get("date") and b.get("close") is not None]
    return {
        "key": key,
        "label": label,
        "yfTicker": yf_ticker,
        "last": round(last, 2) if last is not None else None,
        "prevClose": round(prev, 2) if prev is not None else None,
        "changePct": change_pct,
        "asOf": dated[-1] if dated else None,
    }


def vix_rank(bars: list[dict]) -> dict | None:
    """Percentiles the latest VIX close within its trailing window, reporting the sample used."""
    closes = _closes(bars)
    if not closes:
        return None
    window = closes[-TAPE_RANK_WINDOW:]
    last = closes[-1]
    pct = percentile_rank(window, last) if len(window) >= TAPE_RANK_MIN_SAMPLE else None
    return {
        "last": round(last, 2),
        "pct": round(pct, 1) if pct is not None else None,
        "barsRanked": len(window),
        "low": round(min(window), 2),
        "high": round(max(window), 2),
    }
