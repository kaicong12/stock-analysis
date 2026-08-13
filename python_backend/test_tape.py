"""Tests for the market-tape math behind /market/tape."""

from config import TAPE_RANK_MIN_SAMPLE, TAPE_RANK_WINDOW
from tape_util import quote_from_bars, vix_rank


def _bars(closes: list[float], start_day: int = 1) -> list[dict]:
    return [
        {"date": f"2026-01-{start_day + i:02d}", "close": c}
        for i, c in enumerate(closes)
    ]


def test_change_pct_is_session_over_session():
    q = quote_from_bars("sp500", "S&P 500", "^GSPC", _bars([100.0, 101.0]))
    assert q["last"] == 101.0
    assert q["prevClose"] == 100.0
    assert q["changePct"] == 1.0


def test_single_bar_keeps_the_level_and_nulls_the_change():
    q = quote_from_bars("vix", "VIX", "^VIX", _bars([18.4]))
    assert q["last"] == 18.4
    assert q["prevClose"] is None
    assert q["changePct"] is None


def test_no_bars_nulls_every_field_but_keeps_identity():
    q = quote_from_bars("wti", "WTI Crude", "CL=F", [])
    assert q["key"] == "wti"
    assert q["label"] == "WTI Crude"
    assert (q["last"], q["prevClose"], q["changePct"], q["asOf"]) == (None, None, None, None)


def test_as_of_is_the_latest_dated_close():
    q = quote_from_bars("dow", "Dow", "^DJI", _bars([1.0, 2.0, 3.0]))
    assert q["asOf"] == "2026-01-03"


def test_bars_missing_close_are_skipped():
    bars = [{"date": "2026-01-01", "close": 10.0}, {"date": "2026-01-02", "close": None}]
    q = quote_from_bars("dow", "Dow", "^DJI", bars)
    assert q["last"] == 10.0
    assert q["asOf"] == "2026-01-01"


def test_vix_rank_ranks_within_the_trailing_window():
    closes = [float(i) for i in range(1, TAPE_RANK_MIN_SAMPLE + 1)]  # ascending
    r = vix_rank(_bars(closes))
    assert r["last"] == float(TAPE_RANK_MIN_SAMPLE)
    # percentile_rank counts ties as half and the last close is in the window.
    assert r["pct"] == 99.7
    assert r["low"] == 1.0
    assert r["high"] == float(TAPE_RANK_MIN_SAMPLE)


def test_vix_rank_flat_history_reads_mid():
    r = vix_rank(_bars([20.0] * TAPE_RANK_MIN_SAMPLE))
    assert r["pct"] == 50.0


def test_vix_rank_percentile_is_none_below_min_sample():
    r = vix_rank(_bars([float(i) for i in range(1, TAPE_RANK_MIN_SAMPLE)]))
    assert r["pct"] is None
    assert r["last"] is not None


def test_vix_rank_reports_the_sample_it_actually_used():
    r = vix_rank(_bars([20.0] * (TAPE_RANK_WINDOW + 80)))
    assert r["barsRanked"] == TAPE_RANK_WINDOW


def test_vix_rank_window_excludes_older_regimes():
    closes = [90.0] * 40 + [15.0] * TAPE_RANK_WINDOW
    r = vix_rank(_bars(closes))
    assert r["high"] == 15.0
    assert r["barsRanked"] == TAPE_RANK_WINDOW


def test_vix_rank_none_without_bars():
    assert vix_rank([]) is None
