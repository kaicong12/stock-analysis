"""yfinance daily bars, cached in SQLite once per calendar day per ticker."""

import datetime as dt
import math

from fastapi import HTTPException

from store import db
from util import to_float


def _today() -> str:
    return dt.date.today().isoformat()


def daily_closes(yf_ticker: str, n_bars: int = 80) -> list[float]:
    """Most recent N daily closes, ascending. Sized for a 60-day HV window."""
    today = _today()

    with db() as conn:
        row = conn.execute(
            "SELECT last_refresh_date FROM daily_closes_sync WHERE yf_ticker = ?",
            (yf_ticker,),
        ).fetchone()
        if row and row[0] == today:
            rows = conn.execute(
                "SELECT close FROM daily_closes WHERE yf_ticker = ? "
                "ORDER BY close_date DESC LIMIT ?",
                (yf_ticker, n_bars),
            ).fetchall()
            if len(rows) >= 32:
                return [float(r[0]) for r in reversed(rows)]

    import yfinance as yf  # lazy: keeps cold start off unrelated routes

    # Ask for ~2x calendar days to absorb weekends and holidays.
    period_days = max(n_bars * 2, 120)
    try:
        hist = yf.Ticker(yf_ticker).history(
            period=f"{period_days}d", interval="1d", auto_adjust=False
        )
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
        bars.append((ts.strftime("%Y-%m-%d"), c))
    if not bars:
        return []
    bars = bars[-n_bars:]

    with db() as conn:
        with conn:
            conn.executemany(
                "INSERT OR REPLACE INTO daily_closes (yf_ticker, close_date, close) "
                "VALUES (?, ?, ?)",
                [(yf_ticker, d, c) for d, c in bars],
            )
            conn.execute(
                "INSERT OR REPLACE INTO daily_closes_sync "
                "(yf_ticker, last_refresh_date, bars_count) VALUES (?, ?, ?)",
                (yf_ticker, today, len(bars)),
            )
    return [c for _, c in bars]


def daily_ohlcv(yf_ticker: str, n_bars: int = 220) -> list[dict]:
    """Most recent N daily OHLCV bars, ascending. Closes alone can't carry the
    open and volume the price-action signal needs, hence a separate cache.

    Returns [] rather than raising — the price-action signal must degrade to
    'none' instead of breaking the verdict.
    """
    today = _today()

    with db() as conn:
        row = conn.execute(
            "SELECT last_refresh_date FROM daily_ohlcv_sync WHERE yf_ticker = ?",
            (yf_ticker,),
        ).fetchone()
        if row and row[0] == today:
            rows = conn.execute(
                "SELECT bar_date, open, high, low, close, volume FROM daily_ohlcv "
                "WHERE yf_ticker = ? ORDER BY bar_date DESC LIMIT ?",
                (yf_ticker, n_bars),
            ).fetchall()
            if len(rows) >= 30:
                return [
                    {"date": r[0], "open": r[1], "high": r[2], "low": r[3],
                     "close": r[4], "volume": r[5]}
                    for r in reversed(rows)
                ]

    try:
        import yfinance as yf

        period_days = max(n_bars * 2, 320)
        hist = yf.Ticker(yf_ticker).history(
            period=f"{period_days}d", interval="1d", auto_adjust=False
        )
    except Exception:
        return []
    if hist is None or hist.empty or "Close" not in hist:
        return []

    bars: list[dict] = []
    for ts, r in hist.iterrows():
        vals = [to_float(r.get(k)) for k in ("Open", "High", "Low", "Close")]
        if any(v is None for v in vals):
            continue
        bars.append({
            "date": ts.strftime("%Y-%m-%d"),
            "open": vals[0], "high": vals[1], "low": vals[2], "close": vals[3],
            "volume": to_float(r.get("Volume")) or 0.0,
        })
    if not bars:
        return []
    bars = bars[-n_bars:]

    with db() as conn:
        with conn:
            conn.executemany(
                "INSERT OR REPLACE INTO daily_ohlcv "
                "(yf_ticker, bar_date, open, high, low, close, volume) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(yf_ticker, b["date"], b["open"], b["high"], b["low"],
                  b["close"], b["volume"]) for b in bars],
            )
            conn.execute(
                "INSERT OR REPLACE INTO daily_ohlcv_sync "
                "(yf_ticker, last_refresh_date, bars_count) VALUES (?, ?, ?)",
                (yf_ticker, today, len(bars)),
            )
    return bars
