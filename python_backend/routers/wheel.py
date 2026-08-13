"""Wheel-strategy data: the vol-regime proxy and the per-strike chain table."""

import datetime as dt
import math

from fastapi import APIRouter, HTTPException, Query
from moomoo import OptionType, RET_OK

from bars import daily_closes
from config import (
    WHEEL_ATM_SAMPLE, WHEEL_IV_HV_RICH, WHEEL_HV_PCT_RICH,
    WHEEL_ROWS_PER_SIDE, WHEEL_TARGET_DTES, WHEEL_HV_MIN_SAMPLE,
)
from indicators import historical_vol, historical_vol_series, percentile_rank
from models import VolRegimeResponse, WheelChainResponse
from opend import quote_ctx
from util import normalize, to_float, to_yf_ticker
from vol_util import nearest, pick_expiries, snapshot_by_code

router = APIRouter()

# HV30 needs 31 closes; ranking it over a trailing year needs ~252 more.
HV_RANK_BARS = 282


def _atm_iv(ctx, symbol: str, spot: float, target_dte: int) -> tuple[float | None, str | None, int | None]:
    """ATM IV (decimal) at the expiry nearest target_dte, or (None, None, None)."""
    ret, exp = ctx.get_option_expiration_date(code=symbol)
    if ret != RET_OK:
        return None, None, None
    exp_rows = normalize(exp) if exp is not None else []
    if not isinstance(exp_rows, list) or not exp_rows:
        return None, None, None

    today = dt.date.today()
    picked = pick_expiries(exp_rows, today, [target_dte])
    if not picked:
        return None, None, None
    expiry_iso, expiry_date = picked[0]

    ret, chain = ctx.get_option_chain(
        code=symbol, start=expiry_iso, end=expiry_iso, option_type=OptionType.ALL,
    )
    if ret != RET_OK:
        return None, None, None
    rows = normalize(chain) if chain is not None else []
    if not isinstance(rows, list):
        return None, None, None
    lo, hi = spot * 0.95, spot * 1.05
    rows = [r for r in rows
            if isinstance(r.get("strike_price"), (int, float))
            and lo <= r["strike_price"] <= hi]
    if not rows:
        return None, None, None

    codes = [r["code"] for r in rows if isinstance(r.get("code"), str)]
    try:
        snaps = snapshot_by_code(ctx, codes)
    except RuntimeError:
        return None, None, None

    legs: list[dict] = []
    for r in rows:
        c = r.get("code")
        if not isinstance(c, str):
            continue
        iv_pct = to_float(snaps.get(c, {}).get("option_implied_volatility"))
        strike = to_float(r.get("strike_price"))
        if iv_pct is None or strike is None or iv_pct <= 0:
            continue
        legs.append({"strike": strike, "iv": iv_pct / 100.0})

    atm = nearest(legs, "strike", spot)
    if not atm:
        return None, None, None
    return atm["iv"], expiry_iso, (expiry_date - today).days


@router.get("/vol/regime", response_model=VolRegimeResponse)
def vol_regime(
    symbol: str = Query(..., description="e.g. US.AAPL"),
    target_dte: int = Query(30, description="Expiry closest to N DTE for the IV leg"),
):
    """HV30, its trailing-1yr percentile and IV/HV — a PROXY for IV Rank, ranking realized vol."""
    yf_ticker = to_yf_ticker(symbol)
    closes = daily_closes(yf_ticker, n_bars=HV_RANK_BARS)

    hv30 = historical_vol(closes, window=30)
    series = historical_vol_series(closes, window=30)
    # Trailing year only; a longer window dilutes the rank with stale regimes.
    series = series[-252:]
    hv30_pct = percentile_rank(series, hv30) if (hv30 is not None and series) else None

    atm_iv = expiry_used = dte = chain_error = None
    try:
        with quote_ctx() as ctx:
            ret, snap = ctx.get_market_snapshot([symbol])
            spot = None
            if ret == RET_OK and snap is not None:
                rows = normalize(snap)
                if isinstance(rows, list) and rows:
                    spot = to_float(rows[0].get("last_price"))
            if spot and spot > 0:
                atm_iv, expiry_used, dte = _atm_iv(ctx, symbol, spot, target_dte)
            else:
                chain_error = f"no spot for {symbol}"
    except Exception as exc:
        chain_error = f"{type(exc).__name__}: {exc}"

    iv_hv = (atm_iv / hv30) if (atm_iv is not None and hv30 and hv30 > 0) else None

    enough = len(series) >= WHEEL_HV_MIN_SAMPLE
    if not enough or hv30_pct is None:
        label = "n/a"
    else:
        hv_elevated = hv30_pct >= WHEEL_HV_PCT_RICH
        iv_rich = iv_hv is not None and iv_hv >= WHEEL_IV_HV_RICH
        if hv_elevated and iv_rich:
            label = "rich"
        elif hv_elevated or iv_rich:
            label = "fair"
        else:
            label = "thin"

    return {
        "symbol": symbol,
        "yfTicker": yf_ticker,
        "hv30": hv30,
        "hv30Pct": round(hv30_pct, 1) if hv30_pct is not None else None,
        "hv30Low": min(series) if series else None,
        "hv30High": max(series) if series else None,
        "atmIv": atm_iv,
        "expiryUsed": expiry_used,
        "dte": dte,
        "ivHv30": round(iv_hv, 3) if iv_hv is not None else None,
        "chainError": chain_error,
        "label": label,
        "sampleBars": len(series),
    }


def _expected_move_band(
    ctx, chain_rows: list[dict], spot: float, dte: int
) -> tuple[float, float] | None:
    """1-SD bounds around spot, from the ATM IV read off this expiry's near-the-money strikes."""
    if dte <= 0:
        return None
    lo, hi = spot * (1 - WHEEL_ATM_SAMPLE), spot * (1 + WHEEL_ATM_SAMPLE)
    sample = [r for r in chain_rows if lo <= r["strike_price"] <= hi]
    if not sample:
        return None

    snaps = snapshot_by_code(ctx, [r["code"] for r in sample])
    legs = []
    for r in sample:
        iv_pct = to_float(snaps.get(r["code"], {}).get("option_implied_volatility"))
        if iv_pct is not None and iv_pct > 0:
            legs.append({"strike": r["strike_price"], "iv": iv_pct / 100.0})

    atm = nearest(legs, "strike", spot)
    if not atm:
        return None
    move = spot * atm["iv"] * math.sqrt(dte / 365.0)
    return spot - move, spot + move


def _strikes_past_band(chain_rows: list[dict], band: tuple[float, float]) -> list[dict]:
    """Puts below the lower bound and calls above the upper, nearest edge first."""
    lower, upper = band
    puts = sorted(
        (r for r in chain_rows
         if str(r.get("option_type", "")).upper() == "PUT" and r["strike_price"] < lower),
        key=lambda r: -r["strike_price"],
    )
    calls = sorted(
        (r for r in chain_rows
         if str(r.get("option_type", "")).upper() == "CALL" and r["strike_price"] > upper),
        key=lambda r: r["strike_price"],
    )
    return puts[:WHEEL_ROWS_PER_SIDE] + calls[:WHEEL_ROWS_PER_SIDE]


def _leg_rows(chain_rows: list[dict], snaps: dict[str, dict], side: str) -> list[dict]:
    """Per-strike rows for one side of one expiry, strike-ascending; no bid means dropped."""
    out: list[dict] = []
    for r in chain_rows:
        code = r.get("code")
        if not isinstance(code, str):
            continue
        if str(r.get("option_type", "")).upper() != side:
            continue
        s = snaps.get(code, {})
        strike = to_float(r.get("strike_price"))
        bid = to_float(s.get("bid_price"))
        ask = to_float(s.get("ask_price"))
        if strike is None or bid is None or bid <= 0:
            continue
        mid = ((bid + ask) / 2.0) if (ask is not None and ask > 0) else bid
        iv_pct = to_float(s.get("option_implied_volatility"))
        spread_pct = (((ask - bid) / mid) * 100.0) if (ask is not None and ask > bid and mid > 0) else None
        out.append({
            "strike": strike,
            "delta": to_float(s.get("option_delta")),
            "bid": bid,
            "ask": ask,
            "mid": round(mid, 4),
            "iv": (iv_pct / 100.0) if (iv_pct is not None and iv_pct > 0) else None,
            "openInterest": to_float(s.get("option_open_interest")),
            "volume": to_float(s.get("volume")),
            "spreadPct": round(spread_pct, 1) if spread_pct is not None else None,
        })
    out.sort(key=lambda r: r["strike"])
    return out


@router.get("/options/wheel-chain", response_model=WheelChainResponse)
def wheel_chain(
    symbol: str = Query(..., description="e.g. US.AAPL"),
    target_dtes: str = Query("", description="Comma-separated DTEs; defaults to 21,30,45"),
):
    """Per-strike puts and calls beyond the expected-move band, across a few near-dated expiries."""
    targets = WHEEL_TARGET_DTES
    if target_dtes.strip():
        parsed = [int(p) for p in target_dtes.split(",") if p.strip().isdigit()]
        if parsed:
            targets = parsed

    today = dt.date.today()
    with quote_ctx() as ctx:
        ret, snap = ctx.get_market_snapshot([symbol])
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap}")
        rows = normalize(snap) if snap is not None else []
        spot = to_float(rows[0].get("last_price")) if isinstance(rows, list) and rows else None
        if not spot or spot <= 0:
            raise HTTPException(status_code=502, detail=f"no spot for {symbol}")

        ret, exp = ctx.get_option_expiration_date(code=symbol)
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_option_expiration_date: {exp}")
        exp_rows = normalize(exp) if exp is not None else []
        if not isinstance(exp_rows, list) or not exp_rows:
            raise HTTPException(status_code=502, detail=f"no option expiries for {symbol}")

        picked = pick_expiries(exp_rows, today, targets)
        if not picked:
            raise HTTPException(status_code=502, detail=f"no future expiry for {symbol}")

        expiries: list[dict] = []
        for expiry_iso, expiry_date in picked:
            dte = (expiry_date - today).days
            ret, chain = ctx.get_option_chain(
                code=symbol, start=expiry_iso, end=expiry_iso, option_type=OptionType.ALL,
            )
            if ret != RET_OK:
                continue
            chain_rows = normalize(chain) if chain is not None else []
            if not isinstance(chain_rows, list) or not chain_rows:
                continue
            chain_rows = [r for r in chain_rows
                          if isinstance(r.get("strike_price"), (int, float))
                          and isinstance(r.get("code"), str)]
            if not chain_rows:
                continue

            try:
                band = _expected_move_band(ctx, chain_rows, spot, dte)
                if band is None:
                    continue
                wanted = _strikes_past_band(chain_rows, band)
                if not wanted:
                    continue
                snaps = snapshot_by_code(ctx, [r["code"] for r in wanted])
            except RuntimeError as exc:
                raise HTTPException(status_code=502, detail=str(exc))

            puts = _leg_rows(wanted, snaps, "PUT")
            calls = _leg_rows(wanted, snaps, "CALL")
            if not puts and not calls:
                continue
            expiries.append({
                "expiry": expiry_iso,
                "dte": dte,
                "puts": puts,
                "calls": calls,
            })

    if not expiries:
        raise HTTPException(status_code=502, detail=f"no quotable strikes for {symbol}")

    return {"symbol": symbol, "spot": spot, "expiries": expiries}
