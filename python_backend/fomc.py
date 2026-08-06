"""Scheduled FOMC meeting dates.

Hardcoded rather than fetched: this backs a veto, and a veto that silently stops
firing because a scrape drifted is worse than one that needs an annual edit. The
Fed publishes the full year ~18 months ahead and effectively never moves a date.

Source: federalreserve.gov/monetarypolicy/fomccalendars.htm
Refresh each December when the following year's calendar is added.
"""

import datetime as dt

# (first_day, last_day) — the decision lands on the last day.
MEETINGS: list[tuple[dt.date, dt.date]] = [
    (dt.date(2026, 1, 27), dt.date(2026, 1, 28)),
    (dt.date(2026, 3, 17), dt.date(2026, 3, 18)),
    (dt.date(2026, 4, 28), dt.date(2026, 4, 29)),
    (dt.date(2026, 6, 16), dt.date(2026, 6, 17)),
    (dt.date(2026, 7, 28), dt.date(2026, 7, 29)),
    (dt.date(2026, 9, 15), dt.date(2026, 9, 16)),
    (dt.date(2026, 10, 27), dt.date(2026, 10, 28)),
    (dt.date(2026, 12, 8), dt.date(2026, 12, 9)),
    (dt.date(2027, 1, 26), dt.date(2027, 1, 27)),
    (dt.date(2027, 3, 16), dt.date(2027, 3, 17)),
    (dt.date(2027, 4, 27), dt.date(2027, 4, 28)),
    (dt.date(2027, 6, 8), dt.date(2027, 6, 9)),
    (dt.date(2027, 7, 27), dt.date(2027, 7, 28)),
    (dt.date(2027, 9, 14), dt.date(2027, 9, 15)),
    (dt.date(2027, 10, 26), dt.date(2027, 10, 27)),
    (dt.date(2027, 12, 7), dt.date(2027, 12, 8)),
]

CALENDAR_THROUGH = dt.date(2027, 12, 31)


def meetings_in_window(start: dt.date, end: dt.date) -> list[str]:
    """Decision dates landing in [start, end], as ISO strings."""
    return [d.isoformat() for _, d in MEETINGS if start <= d <= end]


def calendar_is_stale(end: dt.date) -> bool:
    """True when the window runs past the encoded calendar, so callers can say
    'unknown' instead of reporting a clean window that was never checked."""
    return end > CALENDAR_THROUGH
