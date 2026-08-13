"""Pure indicator math over daily bars. No I/O, no framework."""

import math
from statistics import stdev


def sma(closes: list[float], window: int) -> float | None:
    """Simple moving average over the last `window` closes."""
    if len(closes) < window:
        return None
    return sum(closes[-window:]) / window


def ema(values: list[float], span: int) -> list[float]:
    """Full EMA series, seeded with the first value."""
    if not values:
        return []
    k = 2 / (span + 1)
    e = values[0]
    out = [e]
    for v in values[1:]:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def historical_vol(closes: list[float], window: int) -> float | None:
    """Annualized HV (sqrt(252), sample stddev) from close-to-close log returns, as a decimal."""
    if len(closes) < window + 1:
        return None
    sub = closes[-(window + 1):]
    returns = [
        math.log(sub[i] / sub[i - 1])
        for i in range(1, len(sub))
        if sub[i - 1] > 0 and sub[i] > 0
    ]
    if len(returns) < 2:
        return None
    return stdev(returns) * math.sqrt(252)


def historical_vol_series(closes: list[float], window: int = 30) -> list[float]:
    """HV at every full `window`, ascending; its last element equals historical_vol exactly."""
    if len(closes) < window + 1:
        return []
    returns = [
        math.log(closes[i] / closes[i - 1]) if (closes[i - 1] > 0 and closes[i] > 0) else 0.0
        for i in range(1, len(closes))
    ]
    root = math.sqrt(252)
    return [
        stdev(returns[i - window:i]) * root
        for i in range(window, len(returns) + 1)
    ]


def percentile_rank(series: list[float], value: float) -> float | None:
    """Where `value` sits within `series`, 0-100, counting ties as half."""
    if not series:
        return None
    below = sum(1 for s in series if s < value)
    equal = sum(1 for s in series if s == value)
    return (below + 0.5 * equal) / len(series) * 100


def rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder's RSI at the latest bar."""
    series = rsi_series(closes, period)
    return series[-1] if series else None


def rsi_series(closes: list[float], period: int = 14) -> list[float | None]:
    """Wilder RSI at every bar, index-aligned to `closes`."""
    n = len(closes)
    out: list[float | None] = [None] * n
    if n < period + 1:
        return out

    gains = [max(closes[i] - closes[i - 1], 0.0) for i in range(1, n)]
    losses = [max(closes[i - 1] - closes[i], 0.0) for i in range(1, n)]

    def value(avg_gain: float, avg_loss: float) -> float:
        """RSI from a smoothed average gain and loss."""
        if avg_loss == 0:
            return 100.0
        return 100 - 100 / (1 + avg_gain / avg_loss)

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    out[period] = value(avg_gain, avg_loss)
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = value(avg_gain, avg_loss)
    return out


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    """(macd_line, signal_line, histogram) at the latest bar."""
    if len(closes) < slow + signal:
        return None, None, None
    line = [f - s for f, s in zip(ema(closes, fast), ema(closes, slow))]
    sig = ema(line, signal)
    return line[-1], sig[-1], line[-1] - sig[-1]


def bbands(closes: list[float], window: int = 20, k: float = 2.0):
    """(upper, mid, lower, %B) at the latest bar, on population stddev."""
    if len(closes) < window:
        return None, None, None, None
    w = closes[-window:]
    mid = sum(w) / window
    sd = math.sqrt(sum((x - mid) ** 2 for x in w) / window)
    upper, lower = mid + k * sd, mid - k * sd
    pct_b = ((closes[-1] - lower) / (upper - lower)) if upper > lower else None
    return upper, mid, lower, pct_b


def adx(highs: list[float], lows: list[float], closes: list[float], period: int = 14):
    """Wilder's ADX (trend strength) plus the latest +DI / -DI (direction)."""
    n = len(closes)
    if n < 2 * period + 1:
        return None, None, None

    trs, plus_dm, minus_dm = [], [], []
    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm.append(up if (up > down and up > 0) else 0.0)
        minus_dm.append(down if (down > up and down > 0) else 0.0)
        trs.append(max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        ))

    atr_sum = sum(trs[:period])
    sp_dm = sum(plus_dm[:period])
    sm_dm = sum(minus_dm[:period])
    dxs: list[float] = []
    plus_di = minus_di = 0.0
    for i in range(period, len(trs)):
        atr_sum = atr_sum - atr_sum / period + trs[i]
        sp_dm = sp_dm - sp_dm / period + plus_dm[i]
        sm_dm = sm_dm - sm_dm / period + minus_dm[i]
        if atr_sum == 0:
            continue
        plus_di = 100 * sp_dm / atr_sum
        minus_di = 100 * sm_dm / atr_sum
        denom = plus_di + minus_di
        dxs.append(100 * abs(plus_di - minus_di) / denom if denom else 0.0)

    if len(dxs) < period:
        return None, None, None
    value = sum(dxs[:period]) / period
    for i in range(period, len(dxs)):
        value = (value * (period - 1) + dxs[i]) / period
    return value, plus_di, minus_di


def atr(highs: list[float], lows: list[float], closes: list[float],
        period: int = 14) -> float | None:
    """Wilder's ATR at the latest bar."""
    if len(closes) < period + 1:
        return None
    trs = [
        max(highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]))
        for i in range(1, len(closes))
    ]
    value = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        value = (value * (period - 1) + trs[i]) / period
    return value


def run_length(closes: list[float], direction: int) -> int:
    """Consecutive trailing days moving in `direction` (+1 up, -1 down)."""
    run = 0
    for i in range(len(closes) - 1, 0, -1):
        diff = closes[i] - closes[i - 1]
        if (direction > 0 and diff > 0) or (direction < 0 and diff < 0):
            run += 1
        else:
            break
    return run


def pivot_indices(values: list[float | None], left: int, right: int, kind: str) -> list[int]:
    """Local extrema indices; the newest detectable pivot is always `right` bars old."""
    out: list[int] = []
    n = len(values)
    for i in range(left, n - right):
        v = values[i]
        if v is None:
            continue
        window = values[i - left:i + right + 1]
        if any(w is None for w in window):
            continue
        if kind == "high" and v >= max(window) and v > min(window):
            out.append(i)
        elif kind == "low" and v <= min(window) and v < max(window):
            out.append(i)
    return out


def rsi_divergence(closes: list[float], rsi_vals: list[float | None],
                   lookback: int = 60, left: int = 3, right: int = 3) -> str:
    """Regular RSI/price divergence: "bearish", "bullish", or "none"."""
    n = len(closes)
    if n < lookback // 2:
        return "none"
    start = max(0, n - lookback)

    highs = [i for i in pivot_indices(closes, left, right, "high") if i >= start]
    if len(highs) >= 2:
        a, b = highs[-2], highs[-1]
        if b - a >= 5 and rsi_vals[a] is not None and rsi_vals[b] is not None:
            if closes[b] > closes[a] and rsi_vals[b] < rsi_vals[a]:
                return "bearish"

    lows = [i for i in pivot_indices(closes, left, right, "low") if i >= start]
    if len(lows) >= 2:
        a, b = lows[-2], lows[-1]
        if b - a >= 5 and rsi_vals[a] is not None and rsi_vals[b] is not None:
            if closes[b] < closes[a] and rsi_vals[b] > rsi_vals[a]:
                return "bullish"

    return "none"


def regime(adx_val: float | None, plus_di: float | None, minus_di: float | None,
           spot: float, sma50: float | None, sma200: float | None) -> str:
    """Trend regime: strong_uptrend | uptrend | range | downtrend | strong_downtrend | n/a."""
    if adx_val is None:
        return "n/a"

    up_votes = down_votes = 0
    if plus_di is not None and minus_di is not None:
        if plus_di > minus_di:
            up_votes += 1
        elif minus_di > plus_di:
            down_votes += 1
    for ma in (sma50, sma200):
        if ma is not None:
            if spot > ma:
                up_votes += 1
            else:
                down_votes += 1

    if adx_val < 20:
        return "range"
    strong = adx_val >= 35
    if up_votes >= down_votes:
        return "strong_uptrend" if strong else "uptrend"
    return "strong_downtrend" if strong else "downtrend"
