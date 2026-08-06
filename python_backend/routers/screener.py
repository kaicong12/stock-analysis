"""Credit-spread screener.

Four stages, narrowing hard:
  0. one market-wide get_option_screen call for the IV/liquidity universe
  1. exchange + listing-age post-filter (fields the screener has no filter for)
  2. binary-event veto, then the expected-move / support / trend guards
  3. price the actual spread off the chain

Rejects are returned alongside candidates. An empty candidate list is a normal
outcome here, and without the reject rows it is indistinguishable from a broken
screener — see the value-scale note on _screen().
"""

import datetime as dt
import math
import re
import threading
import time

from fastapi import APIRouter, HTTPException, Query
from moomoo import (
    OptIndicator,
    OptionScreenRequest,
    OptMarketCategory,
    OptUnderlyingIndicator,
    OptionType,
    RET_OK,
)

import fomc
from bars import daily_ohlcv
from config import (
    SCR_DELTA_HI, SCR_DELTA_LO, SCR_DTE_MAX, SCR_DTE_MIN, SCR_EXCHANGES,
    SCR_MAX_SPREAD_PCT, SCR_MIN_CAP, SCR_MIN_CREDIT_WIDTH, SCR_MIN_IVR,
    SCR_MIN_IV_HV, SCR_MIN_LISTING_YEARS, SCR_MIN_OI, SCR_MIN_OPT_VOLUME,
    SCR_FOMC_HARD_VETO, SCR_MIN_OTM_PROB, SCR_MIN_PRICE, SCR_MIN_UL_VOLUME,
    SCR_SCREEN_MIN_GAP_S,
    SCR_WIDTH_PCT,
)
from indicators import sma
from levels import levels
from opend import quote_ctx
from routers.fundamentals import _calendar_dict, _first_date
from util import normalize, to_float, to_yf_ticker

router = APIRouter()

# US equity option code, e.g. US.NVDA260918P190000
_CODE_RE = re.compile(r"^(?P<mkt>[A-Z]+)\.(?P<tkr>[A-Z]+)(?P<ymd>\d{6})(?P<cp>[CP])\d+$")

# The screener takes OPTION_TYPE as a proto int, not the OptionType string enum.
_OPT_TYPE_PUT = 2

# How far through the per-contract gates each rejection reason sits.
_GATE_ORDER = {
    "earnings": 1, "fomc": 1, "expected_move": 2, "support": 3,
    "no_quote": 4, "wide_quote": 5, "thin_credit": 6,
}

# get_option_screen is capped at 10 req / 30s server-side.
_screen_lock = threading.Lock()
_last_screen = [0.0]


def _throttle() -> None:
    with _screen_lock:
        gap = time.monotonic() - _last_screen[0]
        if gap < SCR_SCREEN_MIN_GAP_S:
            time.sleep(SCR_SCREEN_MIN_GAP_S - gap)
        _last_screen[0] = time.monotonic()


def _parse_code(code: str) -> tuple[str, dt.date] | None:
    m = _CODE_RE.match(code or "")
    if not m or m.group("cp") != "P":
        return None
    try:
        expiry = dt.datetime.strptime(m.group("ymd"), "%y%m%d").date()
    except ValueError:
        return None
    return f"{m.group('mkt')}.{m.group('tkr')}", expiry


def _screen(dte_min: int, dte_max: int) -> list[dict]:
    """Stage 0.

    The SDK docstring's own example passes IV as a scaled integer; that is wrong
    for these fields. IV, IV_RANK, HV and IV_HV_RATIO are DECIMALS (0.50 = IVR
    50) while MARKET_CAP / STOCK_PRICE / VOLUME are raw units. Passing 50 for
    IV_RANK returns RET_OK with zero rows — a silent empty screener.
    """
    req = OptionScreenRequest(market_categories=[OptMarketCategory.US_STOCK])
    req.add_underlying_filter(OptUnderlyingIndicator.MARKET_CAP, lower=float(SCR_MIN_CAP))
    req.add_underlying_filter(OptUnderlyingIndicator.STOCK_PRICE, lower=float(SCR_MIN_PRICE))
    req.add_underlying_filter(OptUnderlyingIndicator.VOLUME, lower=float(SCR_MIN_UL_VOLUME))
    req.add_underlying_filter(OptUnderlyingIndicator.IV_RANK, lower=SCR_MIN_IVR)
    req.add_underlying_filter(OptUnderlyingIndicator.IV_HV_RATIO, lower=SCR_MIN_IV_HV)

    req.add_option_filter(OptIndicator.OPTION_TYPE, values=[_OPT_TYPE_PUT])
    req.add_option_filter(OptIndicator.LEFT_DAY, lower=dte_min, upper=dte_max)
    req.add_option_filter(OptIndicator.OPEN_INTEREST, lower=SCR_MIN_OI)
    req.add_option_filter(OptIndicator.VOLUME, lower=SCR_MIN_OPT_VOLUME)
    req.add_option_filter(OptIndicator.DELTA, lower=SCR_DELTA_LO, upper=SCR_DELTA_HI)
    req.add_option_filter(OptIndicator.OTM_PROBABILITY, lower=SCR_MIN_OTM_PROB)
    req.add_sort(OptIndicator.OPEN_INTEREST, desc=True)

    for ind in (OptUnderlyingIndicator.IV_RANK, OptUnderlyingIndicator.IV,
                OptUnderlyingIndicator.HV, OptUnderlyingIndicator.MARKET_CAP,
                OptUnderlyingIndicator.STOCK_PRICE):
        req.add_underlying_retrieve(ind)
    for ind in (OptIndicator.STRIKE_PRICE, OptIndicator.DELTA, OptIndicator.LEFT_DAY,
                OptIndicator.OPEN_INTEREST, OptIndicator.VOLUME,
                OptIndicator.IMPLIED_VOLATILITY, OptIndicator.BID_PRICE,
                OptIndicator.ASK_PRICE, OptIndicator.OTM_PROBABILITY):
        req.add_option_retrieve(ind)

    _throttle()
    with quote_ctx() as ctx:
        ret, data = ctx.get_option_screen(req)
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"get_option_screen: {data}")
    _, _, df = data
    return normalize(df) if df is not None else []


def _basic_info(symbols: list[str]) -> dict[str, dict]:
    with quote_ctx() as ctx:
        ret, info = ctx.get_stock_basicinfo(market="US", code_list=symbols)
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"get_stock_basicinfo: {info}")
    return {r["code"]: r for r in normalize(info) if isinstance(r.get("code"), str)}


def _event_dates(yf_ticker: str) -> tuple[str | None, str | None]:
    """(next earnings, ex-dividend). Never raises — a lookup failure must not
    silently pass a name through the veto, so callers treat None as unknown."""
    try:
        import yfinance as yf

        t = yf.Ticker(yf_ticker)
        cal = _calendar_dict(t)
        earnings = _first_date(cal.get("Earnings Date") or cal.get("Earnings Date "))
        ex_div = _first_date(cal.get("Ex-Dividend Date"))
        return earnings, ex_div
    except Exception:
        return None, None


def _spread_credit(symbol: str, expiry: dt.date, short_strike: float,
                   spot: float) -> dict | None:
    """Stage 3: net credit off the live chain, filled conservatively (sell the
    short leg at bid, buy the long leg at ask)."""
    target_long = short_strike - max(spot * SCR_WIDTH_PCT, 1.0)
    iso = expiry.isoformat()
    with quote_ctx() as ctx:
        ret, chain = ctx.get_option_chain(code=symbol, start=iso, end=iso,
                                          option_type=OptionType.PUT)
        if ret != RET_OK:
            return None
        rows = [r for r in normalize(chain) or []
                if isinstance(r.get("code"), str)
                and isinstance(r.get("strike_price"), (int, float))]
        if not rows:
            return None
        short_row = min(rows, key=lambda r: abs(r["strike_price"] - short_strike))
        below = [r for r in rows if r["strike_price"] < short_row["strike_price"]]
        if not below:
            return None
        long_row = min(below, key=lambda r: abs(r["strike_price"] - target_long))

        ret, snap = ctx.get_market_snapshot([short_row["code"], long_row["code"]])
        if ret != RET_OK:
            return None
        by_code = {r["code"]: r for r in normalize(snap) or []
                   if isinstance(r.get("code"), str)}

    s, l = by_code.get(short_row["code"], {}), by_code.get(long_row["code"], {})
    short_bid, short_ask = to_float(s.get("bid_price")), to_float(s.get("ask_price"))
    long_ask = to_float(l.get("ask_price"))
    if not short_bid or not long_ask or short_bid <= 0:
        return None

    width = short_row["strike_price"] - long_row["strike_price"]
    credit = short_bid - long_ask
    if width <= 0 or credit <= 0:
        return None
    quote_spread_pct = None
    if short_ask and short_bid:
        mid = (short_ask + short_bid) / 2
        quote_spread_pct = ((short_ask - short_bid) / mid * 100) if mid > 0 else None
    return {
        "shortStrike": short_row["strike_price"],
        "longStrike": long_row["strike_price"],
        "width": round(width, 2),
        "credit": round(credit, 2),
        "creditWidth": round(credit / width, 4),
        "costBasis": round(short_row["strike_price"] - credit, 2),
        "quoteSpreadPct": round(quote_spread_pct, 2) if quote_spread_pct is not None else None,
    }


def _underlying_state(symbol: str) -> dict:
    """Spot-relative structure: support zones, SMA200, expected-move inputs."""
    bars = daily_ohlcv(to_yf_ticker(symbol), n_bars=220)
    if len(bars) < 40:
        return {"support": None, "sma200": None, "spot": None, "barsUsed": len(bars)}
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    closes = [b["close"] for b in bars]
    lv = levels(highs, lows, closes)
    return {
        "support": lv["support"],
        "supportLevels": lv["supportLevels"],
        "structureBias": lv["structureBias"],
        "sma200": sma(closes, 200),
        "spot": closes[-1],
        "barsUsed": len(bars),
    }


def _count_only(build_gates) -> int:
    req = OptionScreenRequest(market_categories=[OptMarketCategory.US_STOCK])
    for fn in build_gates:
        fn(req)
    _throttle()
    with quote_ctx() as ctx:
        ret, data = ctx.get_option_screen(req)
    if ret != RET_OK:
        raise HTTPException(status_code=502, detail=f"get_option_screen: {data}")
    return int(data[1])


@router.get("/screener/funnel")
def funnel(
    dte_min: int = Query(SCR_DTE_MIN, ge=7, le=120),
    dte_max: int = Query(SCR_DTE_MAX, ge=7, le=120),
):
    """Contract count after each gate, cumulatively.

    Zero candidates is a normal result for this screener, which makes a blank
    page ambiguous. This is the liveness proof: it shows the universe collapsing
    gate by gate, so a broken filter looks different from a quiet market.

    One throttled screen call per gate — slow and on-demand, never on page load.
    """
    gates = [
        ("puts only", lambda r: r.add_option_filter(OptIndicator.OPTION_TYPE, values=[_OPT_TYPE_PUT])),
        (f"market cap ≥ ${SCR_MIN_CAP / 1e9:g}B",
         lambda r: r.add_underlying_filter(OptUnderlyingIndicator.MARKET_CAP, lower=float(SCR_MIN_CAP))),
        (f"price ≥ ${SCR_MIN_PRICE}",
         lambda r: r.add_underlying_filter(OptUnderlyingIndicator.STOCK_PRICE, lower=float(SCR_MIN_PRICE))),
        (f"volume ≥ {SCR_MIN_UL_VOLUME / 1000:g}k",
         lambda r: r.add_underlying_filter(OptUnderlyingIndicator.VOLUME, lower=float(SCR_MIN_UL_VOLUME))),
        (f"IV rank ≥ {SCR_MIN_IVR:.0%}",
         lambda r: r.add_underlying_filter(OptUnderlyingIndicator.IV_RANK, lower=SCR_MIN_IVR)),
        (f"IV/HV ≥ {SCR_MIN_IV_HV:.2f}",
         lambda r: r.add_underlying_filter(OptUnderlyingIndicator.IV_HV_RATIO, lower=SCR_MIN_IV_HV)),
        (f"DTE {dte_min}–{dte_max}",
         lambda r: r.add_option_filter(OptIndicator.LEFT_DAY, lower=dte_min, upper=dte_max)),
        (f"open interest ≥ {SCR_MIN_OI:,}",
         lambda r: r.add_option_filter(OptIndicator.OPEN_INTEREST, lower=SCR_MIN_OI)),
        (f"option volume ≥ {SCR_MIN_OPT_VOLUME}",
         lambda r: r.add_option_filter(OptIndicator.VOLUME, lower=SCR_MIN_OPT_VOLUME)),
        (f"Δ {SCR_DELTA_LO} to {SCR_DELTA_HI}",
         lambda r: r.add_option_filter(OptIndicator.DELTA, lower=SCR_DELTA_LO, upper=SCR_DELTA_HI)),
        (f"OTM prob ≥ {SCR_MIN_OTM_PROB:.0%}",
         lambda r: r.add_option_filter(OptIndicator.OTM_PROBABILITY, lower=SCR_MIN_OTM_PROB)),
    ]
    steps = [{"gate": "all US equity options", "contracts": _count_only([])}]
    for i, (label, _) in enumerate(gates, start=1):
        steps.append({"gate": label, "contracts": _count_only([fn for _, fn in gates[:i]])})
    return {"asOf": dt.date.today().isoformat(), "steps": steps}


def _envelope(today: dt.date, screened: int, universe: int, candidates: list[dict],
              rejects: list[dict], dte_min: int, dte_max: int) -> dict:
    """One response shape for every exit path. The early "nothing screened"
    return used to omit `criteria`, which dropped the threshold summary from the
    UI in exactly the case where the user needs to know what produced an empty
    result."""
    return {
        "asOf": today.isoformat(),
        "screened": screened,
        "universe": universe,
        "candidates": candidates,
        "rejects": rejects,
        "fomcCalendarStale": fomc.calendar_is_stale(today + dt.timedelta(days=dte_max)),
        "criteria": {
            "minIvRank": SCR_MIN_IVR, "minIvHv": SCR_MIN_IV_HV,
            "dte": [dte_min, dte_max], "delta": [SCR_DELTA_LO, SCR_DELTA_HI],
            "minOtmProbability": SCR_MIN_OTM_PROB, "minOpenInterest": SCR_MIN_OI,
            "minCreditWidth": SCR_MIN_CREDIT_WIDTH,
            "minListingYears": SCR_MIN_LISTING_YEARS,
        },
    }


@router.get("/screener/credit-spreads")
def credit_spreads(
    dte_min: int = Query(SCR_DTE_MIN, ge=7, le=120),
    dte_max: int = Query(SCR_DTE_MAX, ge=7, le=120),
    limit: int = Query(15, ge=1, le=50),
):
    today = dt.date.today()
    rows = _screen(dte_min, dte_max)

    # Stage 0 returns contracts; the guards operate per underlying.
    by_symbol: dict[str, list[dict]] = {}
    for r in rows:
        parsed = _parse_code(r.get("code", ""))
        if not parsed:
            continue
        symbol, expiry = parsed
        r["_symbol"], r["_expiry"] = symbol, expiry
        by_symbol.setdefault(symbol, []).append(r)
    if not by_symbol:
        return _envelope(today, len(rows), 0, [], [], dte_min, dte_max)

    info = _basic_info(sorted(by_symbol))
    candidates: list[dict] = []
    rejects: list[dict] = []

    for symbol, contracts in by_symbol.items():
        ul = contracts[0].get("underlying") or {}
        meta = info.get(symbol, {})
        head = {
            "symbol": symbol,
            "name": meta.get("name"),
            "ivRank": to_float(ul.get("iv_rank")),
            "iv": to_float(ul.get("iv")),
            "hv": to_float(ul.get("hv")),
            "ivHv": None,
            "marketCap": to_float(ul.get("market_cap")),
            "price": to_float(ul.get("price")),
        }
        if head["iv"] and head["hv"]:
            head["ivHv"] = round(head["iv"] / head["hv"], 3)

        def reject(reason: str, detail: str | None = None):
            rejects.append({**head, "reason": reason, "detail": detail})

        exchange = meta.get("exchange_type")
        if exchange not in SCR_EXCHANGES:
            reject("exchange", f"{exchange or 'unknown'} — not NYSE/NASDAQ")
            continue

        listing = str(meta.get("listing_date") or "")[:10]
        try:
            listed = dt.date.fromisoformat(listing)
        except ValueError:
            listed = None
        if listed is None or (today - listed).days < SCR_MIN_LISTING_YEARS * 365:
            reject("listing_age",
                   f"listed {listing or 'unknown'} — under {SCR_MIN_LISTING_YEARS}y, "
                   "IV rank and the ownership case both lack history")
            continue

        state = _underlying_state(symbol)
        spot = state.get("spot") or head["price"]
        if not spot:
            reject("no_price", "no usable daily bars")
            continue

        sma200 = state.get("sma200")
        if sma200 and spot < sma200:
            reject("downtrend",
                   f"spot {spot:.2f} below SMA200 {sma200:.2f} — not a stock to be "
                   "assigned into and hold")
            continue

        yf_ticker = to_yf_ticker(symbol)
        earnings, ex_div = _event_dates(yf_ticker)

        best: dict | None = None
        near_miss: tuple[str, str] | None = None

        def note(reason: str, detail: str) -> None:
            """Keep the failure from the contract that got FURTHEST through the
            gates. Reporting the first (most liquid) contract's reason instead
            would hide that a deeper strike cleared the levels and died on
            pricing — which is the difference between 'wrong name' and 'right
            name, wrong day'."""
            nonlocal near_miss
            if near_miss is None or _GATE_ORDER[reason] > _GATE_ORDER[near_miss[0]]:
                near_miss = (reason, detail)

        for c in sorted(contracts, key=lambda r: -(to_float(r.get("open_interest")) or 0)):
            expiry = c["_expiry"]
            dte = (expiry - today).days
            if dte <= 0:
                continue
            strike = to_float(c.get("strike_price"))
            iv = to_float(c.get("implied_volatility")) or head["iv"]
            if strike is None or not iv:
                continue

            if earnings and today.isoformat() <= earnings <= expiry.isoformat():
                note("earnings", f"reports {earnings}, inside the {dte}d window")
                continue
            meetings = fomc.meetings_in_window(today, expiry)
            if meetings and SCR_FOMC_HARD_VETO:
                note("fomc", f"FOMC {meetings[0]} inside the {dte}d window")
                continue

            em = spot * iv * math.sqrt(dte / 365.0)
            em_floor = spot - em
            if strike > em_floor:
                note("expected_move",
                     f"short {strike:g} inside 1σ move (−{em:.2f} → {em_floor:.2f})")
                continue

            support = state.get("support")
            if support and strike > support:
                note("support", f"short {strike:g} above nearest support {support:.2f}")
                continue

            priced = _spread_credit(symbol, expiry, strike, spot)
            if not priced:
                note("no_quote", f"no two-sided quote for the {expiry} spread")
                continue
            if priced["quoteSpreadPct"] is not None and priced["quoteSpreadPct"] > SCR_MAX_SPREAD_PCT:
                note("wide_quote", f"short leg quote {priced['quoteSpreadPct']:.1f}% wide")
                continue
            if priced["creditWidth"] < SCR_MIN_CREDIT_WIDTH:
                note("thin_credit",
                     f"credit/width {priced['creditWidth']:.0%} under "
                     f"{SCR_MIN_CREDIT_WIDTH:.0%}")
                continue

            best = {
                **head,
                "spot": round(spot, 2),
                "expiry": expiry.isoformat(),
                "dte": dte,
                "delta": to_float(c.get("delta")),
                "otmProbability": to_float(c.get("otm_probability")),
                "openInterest": to_float(c.get("open_interest")),
                "optionVolume": to_float(c.get("volume")),
                "expectedMove": round(em, 2),
                "expectedMoveFloor": round(em_floor, 2),
                "cushionPct": round((spot - strike) / spot * 100, 2),
                "support": state.get("support"),
                "sma200": round(sma200, 2) if sma200 else None,
                "structureBias": state.get("structureBias"),
                "nextEarningsDate": earnings,
                "exDividendDate": ex_div,
                **priced,
            }
            break

        if best:
            candidates.append(best)
        elif near_miss:
            reject(near_miss[0], near_miss[1])
        else:
            reject("no_contract", "no contract in the requested DTE band survived")

    candidates.sort(key=lambda c: (c["creditWidth"], c["ivHv"] or 0), reverse=True)
    return _envelope(today, len(rows), len(by_symbol), candidates[:limit], rejects,
                     dte_min, dte_max)
