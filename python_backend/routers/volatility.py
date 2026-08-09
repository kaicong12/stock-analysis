"""ATM IV / HV / skew snapshot — hard numbers for the derivatives panel."""

import datetime as dt

from fastapi import APIRouter, HTTPException, Query
from moomoo import OptionType, RET_OK

from bars import daily_closes
from indicators import historical_vol
from opend import quote_ctx
from util import normalize, to_float, to_yf_ticker
from vol_util import SNAPSHOT_CHUNK, nearest as _nearest, pick_expiry as _pick_expiry

router = APIRouter()

# ±25% brackets the 25Δ wings on normal-IV names while keeping the snapshot
# batch small.
STRIKE_WINDOW = 0.25


@router.get("/options/vol-summary")
def vol_summary(
    symbol: str = Query(..., description="e.g. US.AAPL"),
    target_dte: int = Query(30, description="Expiry closest to N DTE for IV sampling"),
):
    """All vol figures are decimals (0.32 = 32%), matching HV, so iv_hv_ratio is
    directly comparable."""
    yf_ticker = to_yf_ticker(symbol)
    today = dt.date.today()

    closes = daily_closes(yf_ticker, n_bars=80)
    hv_30 = historical_vol(closes, window=30)
    hv_60 = historical_vol(closes, window=60)

    with quote_ctx() as ctx:
        ret, snap = ctx.get_market_snapshot([symbol])
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap}")
        snap_rows = normalize(snap) if snap is not None else []
        spot = to_float(snap_rows[0].get("last_price")) if isinstance(snap_rows, list) and snap_rows else None
        if not spot or spot <= 0:
            raise HTTPException(status_code=502, detail=f"no spot for {symbol}")

        ret, exp = ctx.get_option_expiration_date(code=symbol)
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_option_expiration_date: {exp}")
        exp_rows = normalize(exp) if exp is not None else []
        if not isinstance(exp_rows, list) or not exp_rows:
            raise HTTPException(status_code=502, detail=f"no option expiries for {symbol}")

        chosen = _pick_expiry(exp_rows, today, target_dte)
        if not chosen:
            raise HTTPException(status_code=502, detail=f"no future expiry for {symbol}")
        expiry_iso, expiry_date = chosen
        dte = (expiry_date - today).days

        ret, chain = ctx.get_option_chain(
            code=symbol, start=expiry_iso, end=expiry_iso, option_type=OptionType.ALL,
        )
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"get_option_chain: {chain}")
        chain_rows = normalize(chain) if chain is not None else []
        if not isinstance(chain_rows, list):
            chain_rows = []
        lo, hi = spot * (1 - STRIKE_WINDOW), spot * (1 + STRIKE_WINDOW)
        chain_rows = [r for r in chain_rows
                      if isinstance(r.get("strike_price"), (int, float))
                      and lo <= r["strike_price"] <= hi]
        if not chain_rows:
            raise HTTPException(status_code=502, detail=f"empty chain at expiry {expiry_iso}")

        codes = [r["code"] for r in chain_rows if isinstance(r.get("code"), str)]
        snap_by_code: dict[str, dict] = {}
        for i in range(0, len(codes), SNAPSHOT_CHUNK):
            ret, snap2 = ctx.get_market_snapshot(codes[i:i + SNAPSHOT_CHUNK])
            if ret != RET_OK:
                raise HTTPException(status_code=502, detail=f"get_market_snapshot: {snap2}")
            rows = normalize(snap2) if snap2 is not None else []
            if isinstance(rows, list):
                for s in rows:
                    c = s.get("code")
                    if isinstance(c, str):
                        snap_by_code[c] = s

    # moomoo returns option_implied_volatility as a PERCENTAGE (32.5 = 32.5%).
    # Divide by 100 so IV and HV share one scale.
    calls: list[dict] = []
    puts: list[dict] = []
    for r in chain_rows:
        c = r.get("code")
        if not isinstance(c, str):
            continue
        s = snap_by_code.get(c, {})
        iv_pct = to_float(s.get("option_implied_volatility"))
        delta = to_float(s.get("option_delta"))
        strike = to_float(r.get("strike_price"))
        if iv_pct is None or delta is None or strike is None or iv_pct <= 0:
            continue
        entry = {"strike": strike, "delta": delta, "iv": iv_pct / 100.0}
        side = str(r.get("option_type", "")).upper()
        if side == "CALL":
            calls.append(entry)
        elif side == "PUT":
            puts.append(entry)

    atm_call = _nearest(calls, "strike", spot)
    atm_put = _nearest(puts, "strike", spot)
    atm_iv_call = atm_call["iv"] if atm_call else None
    atm_iv_put = atm_put["iv"] if atm_put else None
    if atm_iv_call is not None and atm_iv_put is not None:
        atm_iv = (atm_iv_call + atm_iv_put) / 2.0
    else:
        atm_iv = atm_iv_call if atm_iv_call is not None else atm_iv_put

    # 25Δ risk reversal. Positive = downside protection bid up.
    p25 = _nearest(puts, "delta", -0.25)
    c25 = _nearest(calls, "delta", 0.25)
    skew_25d = (p25["iv"] - c25["iv"]) if (p25 and c25) else None

    return {
        "symbol": symbol,
        "yfTicker": yf_ticker,
        "spot": spot,
        "expiry_used": expiry_iso,
        "dte": dte,
        "atm_iv": atm_iv,
        "atm_iv_call": atm_iv_call,
        "atm_iv_put": atm_iv_put,
        "atm_strike_call": atm_call["strike"] if atm_call else None,
        "atm_strike_put": atm_put["strike"] if atm_put else None,
        "hv_30": hv_30,
        "hv_60": hv_60,
        "iv_hv_ratio": (atm_iv / hv_30) if (atm_iv is not None and hv_30 and hv_30 > 0) else None,
        "skew_25d": skew_25d,
        "skew_25d_call_strike": c25["strike"] if c25 else None,
        "skew_25d_put_strike": p25["strike"] if p25 else None,
        "hv_sample_size": max(0, len(closes) - 1),
    }
