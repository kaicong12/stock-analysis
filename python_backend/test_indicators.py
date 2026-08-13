"""Tests for the HV-rank math behind /vol/regime."""

import math

from indicators import historical_vol, historical_vol_series, percentile_rank


def _series(n: int, up: float, down: float) -> list[float]:
    """Build n+1 closes alternating between the `up` and `down` factors."""
    closes = [100.0]
    for i in range(n):
        closes.append(closes[-1] * (up if i % 2 == 0 else down))
    return closes


def test_series_last_equals_standing_hv():
    """The percentile is only meaningful if both use one convention."""
    closes = _series(200, 1.01, 0.99)
    series = historical_vol_series(closes, 30)
    assert math.isclose(series[-1], historical_vol(closes, 30), rel_tol=1e-12)


def test_series_length_counts_full_windows_only():
    closes = _series(100, 1.01, 0.99)  # 101 closes -> 100 returns
    assert len(historical_vol_series(closes, 30)) == 71


def test_series_empty_when_bars_are_thin():
    assert historical_vol_series([100.0, 101.0], 30) == []
    assert historical_vol_series([], 30) == []


def test_vol_expansion_lands_high_in_its_own_range():
    closes = _series(200, 1.01, 0.99)
    closes += [closes[-1] * (1.05 if i % 2 == 0 else 0.95) for i in range(40)]
    series = historical_vol_series(closes, 30)
    assert percentile_rank(series, historical_vol(closes, 30)) > 90


def test_percentile_rank_mid_ranks_ties():
    assert percentile_rank([0.2] * 50, 0.2) == 50.0


def test_percentile_rank_bounds():
    series = [0.1, 0.2, 0.3, 0.4]
    assert percentile_rank(series, 0.05) == 0.0
    assert percentile_rank(series, 0.5) == 100.0
    assert percentile_rank(series, 0.25) == 50.0


def test_percentile_rank_none_on_empty_series():
    assert percentile_rank([], 0.3) is None
