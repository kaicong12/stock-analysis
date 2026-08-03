"""yfinance fundamentals, plus the earnings and ex-dividend dates."""

import datetime as dt

from fastapi import APIRouter, HTTPException, Query

from util import to_float, to_yf_ticker

router = APIRouter()


def _calendar_dict(ticker) -> dict:
    cal = ticker.calendar
    if hasattr(cal, "to_dict"):
        return cal.to_dict()
    return cal if isinstance(cal, dict) else {}


def _first_date(entry) -> str | None:
    """yfinance returns calendar dates as a dict, a list, or a scalar."""
    if isinstance(entry, dict) and entry:
        first = next(iter(entry.values()), None)
        return str(first)[:10] if first is not None else None
    if isinstance(entry, list) and entry:
        return str(entry[0])[:10]
    if entry is not None:
        return str(entry)[:10]
    return None


@router.get("/fundamentals")
def fundamentals(symbol: str = Query(..., description="e.g. US.AAPL")):
    import yfinance as yf  # lazy: keeps cold start off unrelated routes

    yf_ticker = to_yf_ticker(symbol)
    try:
        t = yf.Ticker(yf_ticker)
        info = t.info or {}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"yfinance: {exc}")

    try:
        cal = _calendar_dict(t)
        # yfinance has shipped the key with a trailing space before now.
        next_earnings = _first_date(cal.get("Earnings Date") or cal.get("Earnings Date "))
    except Exception:
        next_earnings = None

    # Ex-div drives early-assignment risk on short calls. info carries an epoch;
    # the calendar is the fallback.
    ex_div: str | None = None
    try:
        raw_ex = info.get("exDividendDate")
        if raw_ex:
            ex_div = dt.datetime.utcfromtimestamp(int(raw_ex)).date().isoformat()
    except Exception:
        ex_div = None
    if ex_div is None:
        try:
            ex_div = _first_date(_calendar_dict(t).get("Ex-Dividend Date"))
        except Exception:
            ex_div = None

    num = to_float
    return {
        "symbol": symbol,
        "yfTicker": yf_ticker,
        "data": {
            "shortName": info.get("shortName") or info.get("longName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "marketCap": num(info.get("marketCap")),
            "trailingPE": num(info.get("trailingPE")),
            "forwardPE": num(info.get("forwardPE")),
            "pegRatio": num(info.get("pegRatio") or info.get("trailingPegRatio")),
            "priceToBook": num(info.get("priceToBook")),
            "priceToSales": num(info.get("priceToSalesTrailing12Months")),
            "trailingEps": num(info.get("trailingEps")),
            "forwardEps": num(info.get("forwardEps")),
            "earningsGrowth": num(info.get("earningsGrowth")),
            "earningsQuarterlyGrowth": num(info.get("earningsQuarterlyGrowth")),
            "revenueGrowth": num(info.get("revenueGrowth")),
            "revenueTtm": num(info.get("totalRevenue")),
            "profitMargins": num(info.get("profitMargins")),
            "operatingMargins": num(info.get("operatingMargins")),
            "grossMargins": num(info.get("grossMargins")),
            "debtToEquity": num(info.get("debtToEquity")),
            "totalDebt": num(info.get("totalDebt")),
            "totalCash": num(info.get("totalCash")),
            "freeCashflow": num(info.get("freeCashflow")),
            "operatingCashflow": num(info.get("operatingCashflow")),
            "returnOnEquity": num(info.get("returnOnEquity")),
            "returnOnAssets": num(info.get("returnOnAssets")),
            "currentRatio": num(info.get("currentRatio")),
            "quickRatio": num(info.get("quickRatio")),
            "dividendYield": num(info.get("dividendYield")),
            "payoutRatio": num(info.get("payoutRatio")),
            "beta": num(info.get("beta")),
            "fiftyTwoWeekHigh": num(info.get("fiftyTwoWeekHigh")),
            "fiftyTwoWeekLow": num(info.get("fiftyTwoWeekLow")),
            "currentPrice": num(info.get("currentPrice") or info.get("regularMarketPrice")),
            "targetMeanPrice": num(info.get("targetMeanPrice")),
            "targetHighPrice": num(info.get("targetHighPrice")),
            "targetLowPrice": num(info.get("targetLowPrice")),
            "recommendationKey": info.get("recommendationKey"),
            "numberOfAnalystOpinions": num(info.get("numberOfAnalystOpinions")),
            "shortPercentOfFloat": num(info.get("shortPercentOfFloat")),
            "heldPercentInsiders": num(info.get("heldPercentInsiders")),
            "heldPercentInstitutions": num(info.get("heldPercentInstitutions")),
            "currency": info.get("currency"),
            "nextEarningsDate": next_earnings,
            "exDividendDate": ex_div,
        },
    }
