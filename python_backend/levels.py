"""Swing pivots, support/resistance zones, and market structure."""

from indicators import atr


def swing_pivots(highs: list[float], lows: list[float], k: int = 3):
    """Fractal pivots: bar i is a pivot-high if its high is the strict maximum
    of the 2k+1 window centred on it. The last k bars are unconfirmed."""
    n = len(highs)
    ph: list[tuple[int, float]] = []
    pl: list[tuple[int, float]] = []
    for i in range(k, n - k):
        win_h = highs[i - k:i + k + 1]
        win_l = lows[i - k:i + k + 1]
        if highs[i] == max(win_h) and win_h.count(highs[i]) == 1:
            ph.append((i, highs[i]))
        if lows[i] == min(win_l) and win_l.count(lows[i]) == 1:
            pl.append((i, lows[i]))
    return ph, pl


def cluster_levels(pivots: list[tuple[int, float]], tol: float) -> list[dict]:
    """Merge pivots within `tol` (~1 ATR) into zones. A level retested several
    times is stronger than a one-off wick, hence the touch count."""
    if not pivots or tol <= 0:
        return []
    pts = sorted(pivots, key=lambda p: p[1])
    clusters: list[list[tuple[int, float]]] = [[pts[0]]]
    for idx, price in pts[1:]:
        if price - clusters[-1][-1][1] <= tol:
            clusters[-1].append((idx, price))
        else:
            clusters.append([(idx, price)])
    zones = [
        {
            "price": sum(p[1] for p in c) / len(c),
            "touches": len(c),
            "lastIdx": max(p[0] for p in c),
        }
        for c in clusters
    ]
    zones.sort(key=lambda z: z["price"])
    return zones


def market_structure(closes: list[float], pivot_highs: list[tuple[int, float]],
                     pivot_lows: list[tuple[int, float]]):
    """(bias, event, direction, level).

    Bias reads the last two pivot highs and lows. A break in the SAME direction
    as the bias is a BOS (continuation); AGAINST it, a CHoCH — the first tell of
    a reversal.
    """
    bias = "range"
    if len(pivot_highs) >= 2 and len(pivot_lows) >= 2:
        hh = pivot_highs[-1][1] > pivot_highs[-2][1]
        hl = pivot_lows[-1][1] > pivot_lows[-2][1]
        if hh and hl:
            bias = "up"
        elif not hh and not hl:
            bias = "down"

    spot = closes[-1]
    last_ph = pivot_highs[-1] if pivot_highs else None
    last_pl = pivot_lows[-1] if pivot_lows else None
    if last_ph and spot > last_ph[1]:
        return bias, ("BOS" if bias == "up" else "CHoCH"), "up", last_ph[1]
    if last_pl and spot < last_pl[1]:
        return bias, ("BOS" if bias == "down" else "CHoCH"), "down", last_pl[1]
    return bias, "none", "n/a", None


def levels(highs: list[float], lows: list[float], closes: list[float]) -> dict:
    """Support/resistance zones plus market structure.

    Highs and lows are pooled before splitting by side of spot, so a former
    resistance now below price counts as support. Every key is always present
    (null when bars are thin) — this rides into /technical/indicators and must
    never raise.
    """
    out = {
        "support": None, "resistance": None,
        "supportLevels": [], "resistanceLevels": [],
        "structureBias": "n/a", "structureEvent": "none",
        "structureDirection": "n/a", "structureLevel": None,
    }
    if len(closes) < 40:
        return out

    spot = closes[-1]
    tol = atr(highs, lows, closes, 14) or spot * 0.015
    ph, pl = swing_pivots(highs, lows, k=3)
    zones = cluster_levels(ph + pl, tol)
    supports = sorted([z for z in zones if z["price"] < spot], key=lambda z: -z["price"])
    resistances = sorted([z for z in zones if z["price"] > spot], key=lambda z: z["price"])
    bias, event, direction, level = market_structure(closes, ph, pl)

    out["support"] = round(supports[0]["price"], 2) if supports else None
    out["resistance"] = round(resistances[0]["price"], 2) if resistances else None
    out["supportLevels"] = [round(z["price"], 2) for z in supports[:3]]
    out["resistanceLevels"] = [round(z["price"], 2) for z in resistances[:3]]
    out["structureBias"] = bias
    out["structureEvent"] = event
    out["structureDirection"] = direction
    out["structureLevel"] = round(level, 2) if level is not None else None
    return out
