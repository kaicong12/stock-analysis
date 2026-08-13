"""Pydantic response models for the sidecar's routes."""

from pydantic import BaseModel


class SourceError(BaseModel):
    """An upstream failure surfaced to the caller instead of raised."""

    source: str
    message: str


class TapeQuote(BaseModel):
    """One tape row: a level and its session-over-session change."""

    key: str
    label: str
    yfTicker: str
    last: float | None = None
    prevClose: float | None = None
    changePct: float | None = None
    asOf: str | None = None


class VixRank(BaseModel):
    """Where the latest VIX close sits in its own trailing window."""

    last: float
    pct: float | None = None
    barsRanked: int
    low: float
    high: float


class MarketTape(BaseModel):
    """Index, vol and energy closes for the daily digest."""

    asOf: str | None = None
    quotes: list[TapeQuote]
    vix: VixRank | None = None
    errors: list[SourceError] = []
