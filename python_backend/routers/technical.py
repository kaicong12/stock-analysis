"""Deterministic technical state: the price-action signal and standing indicator values."""

from fastapi import APIRouter, Query

from bars import daily_ohlcv
from config import (
    BRK_DRAWDOWN_PCT, BRK_GAP_PCT, BRK_NEAR_EXTREME_PCT, BRK_RUN_DAYS,
    BRK_SEVERE_GAP_PCT, BRK_SEVERE_VOL_RATIO, BRK_VOL_RATIO,
)
from indicators import (
    adx, bbands, historical_vol, macd, regime, rsi, rsi_divergence, rsi_series,
    run_length, sma,
)
from levels import levels
from models import PriceActionResponse, TechnicalIndicatorsResponse
from util import to_yf_ticker

router = APIRouter()


def _round(x, d=2):
    """Round to d places, passing None through."""
    return None if x is None else round(x, d)


@router.get("/price-action", response_model=PriceActionResponse)
def price_action(symbol: str = Query(..., description="e.g. US.AAPL")):
    """Breakdown / breakout signal; returns signal='none' with 200 whenever data is thin."""
    yf_ticker = to_yf_ticker(symbol)
    bars = daily_ohlcv(yf_ticker, n_bars=220)

    base = {
        "symbol": symbol, "yfTicker": yf_ticker, "signal": "none",
        "severity": "none", "reasons": [], "spot": None,
        "sma50": None, "sma200": None, "pctVsSma50": None, "pctVsSma200": None,
        "pctOffHigh20": None, "atLow20": False, "atHigh20": False,
        "consecutiveDownDays": 0, "consecutiveUpDays": 0,
        "todayChangePct": None, "gapPct": None, "volRatio": None,
        "hv30": None, "hv60": None, "hvExpansion": None, "barsUsed": len(bars),
    }
    if len(bars) < 30:
        return base

    closes = [b["close"] for b in bars]
    vols = [b["volume"] for b in bars]
    spot, prev_close, today_open = closes[-1], closes[-2], bars[-1]["open"]

    sma50, sma200 = sma(closes, 50), sma(closes, 200)
    high20, low20 = max(closes[-20:]), min(closes[-20:])
    avg_vol20 = sum(vols[-20:]) / min(20, len(vols)) if vols else 0.0

    pct_vs_50 = ((spot - sma50) / sma50 * 100) if sma50 else None
    pct_vs_200 = ((spot - sma200) / sma200 * 100) if sma200 else None
    pct_off_high20 = ((spot - high20) / high20 * 100) if high20 else None
    at_low20 = bool(low20 > 0 and (spot - low20) / low20 * 100 <= BRK_NEAR_EXTREME_PCT)
    at_high20 = bool(high20 > 0 and (high20 - spot) / high20 * 100 <= BRK_NEAR_EXTREME_PCT)
    down_run, up_run = run_length(closes, -1), run_length(closes, +1)
    today_chg = ((spot - prev_close) / prev_close * 100) if prev_close else None
    gap_pct = ((today_open - prev_close) / prev_close * 100) if prev_close else None
    vol_ratio = (vols[-1] / avg_vol20) if avg_vol20 > 0 else None
    hv30, hv60 = historical_vol(closes, 30), historical_vol(closes, 60)

    below_50 = pct_vs_50 is not None and pct_vs_50 < 0
    above_50 = pct_vs_50 is not None and pct_vs_50 > 0
    below_200 = pct_vs_200 is not None and pct_vs_200 < 0
    heavy_vol = vol_ratio is not None and vol_ratio >= BRK_VOL_RATIO
    gap_down = gap_pct is not None and gap_pct <= -BRK_GAP_PCT
    gap_up = gap_pct is not None and gap_pct >= BRK_GAP_PCT
    deep_drawdown = pct_off_high20 is not None and pct_off_high20 <= -BRK_DRAWDOWN_PCT
    confirmed_down = heavy_vol or gap_down or down_run >= BRK_RUN_DAYS
    confirmed_up = heavy_vol or gap_up or up_run >= BRK_RUN_DAYS

    reasons: list[str] = []
    signal = severity = "none"

    if below_50 and (at_low20 or deep_drawdown) and confirmed_down:
        signal = "breakdown"
        reasons.append(f"{abs(pct_vs_50):.1f}% below 50d MA")
        if below_200:
            reasons.append(f"{abs(pct_vs_200):.1f}% below 200d MA")
        if deep_drawdown:
            reasons.append(f"{abs(pct_off_high20):.1f}% off 20d high")
        elif at_low20:
            reasons.append("at 20-day lows")
        if heavy_vol:
            reasons.append(f"volume {vol_ratio:.1f}x 20d avg")
        if gap_down:
            reasons.append(f"gap-down {gap_pct:.1f}%")
        if down_run >= BRK_RUN_DAYS:
            reasons.append(f"{down_run} consecutive down days")
        severe = below_200 and (
            (gap_pct is not None and gap_pct <= -BRK_SEVERE_GAP_PCT)
            or (vol_ratio is not None and vol_ratio >= BRK_SEVERE_VOL_RATIO)
        )
        severity = "severe" if severe else "mild"

    elif above_50 and at_high20 and confirmed_up:
        signal = "breakout"
        reasons.append("at 20-day highs")
        if pct_vs_50 is not None:
            reasons.append(f"{pct_vs_50:.1f}% above 50d MA")
        if heavy_vol:
            reasons.append(f"volume {vol_ratio:.1f}x 20d avg")
        if gap_up:
            reasons.append(f"gap-up {gap_pct:.1f}%")
        if up_run >= BRK_RUN_DAYS:
            reasons.append(f"{up_run} consecutive up days")
        severity = "mild"

    return {
        **base,
        "signal": signal, "severity": severity, "reasons": reasons,
        "spot": spot, "sma50": sma50, "sma200": sma200,
        "pctVsSma50": pct_vs_50, "pctVsSma200": pct_vs_200,
        "pctOffHigh20": pct_off_high20, "atLow20": at_low20, "atHigh20": at_high20,
        "consecutiveDownDays": down_run, "consecutiveUpDays": up_run,
        "todayChangePct": today_chg, "gapPct": gap_pct, "volRatio": vol_ratio,
        "hv30": hv30, "hv60": hv60,
        "hvExpansion": (hv30 / hv60) if (hv30 and hv60 and hv60 > 0) else None,
    }


@router.get("/technical/indicators", response_model=TechnicalIndicatorsResponse)
def technical_indicators(symbol: str = Query(..., description="e.g. US.MU")):
    """Standing indicator readings; returns 200 with nulls when data is thin."""
    yf_ticker = to_yf_ticker(symbol)
    bars = daily_ohlcv(yf_ticker, n_bars=260)

    base = {
        "symbol": symbol, "yfTicker": yf_ticker, "spot": None, "asOf": None,
        "barsUsed": len(bars),
        "rsi14": None, "rsiState": "n/a",
        "macd": None, "macdSignal": None, "macdHist": None,
        "bbUpper": None, "bbMid": None, "bbLower": None, "bbPctB": None,
        "sma20": None, "sma50": None, "sma200": None,
        "pctVsSma20": None, "pctVsSma50": None, "pctVsSma200": None,
        "high52w": None, "low52w": None, "pctOff52wHigh": None,
        "ret5d": None, "ret20d": None,
        "adx14": None, "plusDi": None, "minusDi": None,
        "regime": "n/a", "rsiDivergence": "none",
        "support": None, "resistance": None,
        "supportLevels": [], "resistanceLevels": [],
        "structureBias": "n/a", "structureEvent": "none",
        "structureDirection": "n/a", "structureLevel": None,
    }
    if len(bars) < 15:
        return base

    closes = [b["close"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    spot = closes[-1]

    def pct_vs(ma):
        """Percent spot sits above(+) or below(-) a moving average."""
        return ((spot - ma) / ma * 100) if ma else None

    rsi14 = rsi(closes, 14)
    macd_v, sig_v, hist = macd(closes)
    bb_u, bb_m, bb_l, bb_pctb = bbands(closes, 20, 2.0)
    sma20, sma50, sma200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    adx14, plus_di, minus_di = adx(highs, lows, closes, 14)
    hi, lo = max(closes), min(closes)
    rsi_state = (
        "overbought" if (rsi14 is not None and rsi14 >= 70)
        else "oversold" if (rsi14 is not None and rsi14 <= 30)
        else "neutral" if rsi14 is not None else "n/a"
    )

    return {
        **base,
        "spot": _round(spot), "asOf": bars[-1]["date"],
        "rsi14": _round(rsi14, 1), "rsiState": rsi_state,
        "macd": _round(macd_v), "macdSignal": _round(sig_v), "macdHist": _round(hist),
        "bbUpper": _round(bb_u), "bbMid": _round(bb_m), "bbLower": _round(bb_l),
        "bbPctB": _round(bb_pctb, 3),
        "sma20": _round(sma20), "sma50": _round(sma50), "sma200": _round(sma200),
        "pctVsSma20": _round(pct_vs(sma20), 1), "pctVsSma50": _round(pct_vs(sma50), 1),
        "pctVsSma200": _round(pct_vs(sma200), 1),
        "high52w": _round(hi), "low52w": _round(lo),
        "pctOff52wHigh": _round((spot - hi) / hi * 100, 1) if hi else None,
        "ret5d": _round((spot / closes[-6] - 1) * 100, 1) if len(closes) >= 6 else None,
        "ret20d": _round((spot / closes[-21] - 1) * 100, 1) if len(closes) >= 21 else None,
        "adx14": _round(adx14, 1), "plusDi": _round(plus_di, 1), "minusDi": _round(minus_di, 1),
        "regime": regime(adx14, plus_di, minus_di, spot, sma50, sma200),
        "rsiDivergence": rsi_divergence(closes, rsi_series(closes, 14)),
        **levels(highs, lows, closes),
    }
