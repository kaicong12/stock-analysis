"""Pydantic response models for the sidecar routes."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """/health."""

    ok: bool
    opend: str
    error: str | None = None


class SnapshotResponse(BaseModel):
    """/snapshot. `data` is a raw moomoo snapshot row, passed through untouched."""

    symbol: str
    data: dict | list | None


class PeerInfo(BaseModel):
    """One large-cap sector peer."""

    code: str
    name: str | None
    capBn: float
    price: float


class PeersResponse(BaseModel):
    """/peers/{symbol}."""

    symbol: str
    industryPlate: str | None
    peers: list[PeerInfo]


class AnomalyResponse(BaseModel):
    """/anomaly/{capital,technical,derivatives}. `data` is a moomoo blob, passed through."""

    method: str
    symbol: str
    time_range: int
    language_id: int
    dimensions: list[str]
    data: dict | list | None


class FundamentalsResponse(BaseModel):
    """/fundamentals. `data` mirrors FundamentalsData in src/lib/types.ts."""

    symbol: str
    yfTicker: str
    data: dict


class MorningstarResponse(BaseModel):
    """/research/morningstar. `report` is the SDK's nested record, passed through."""

    symbol: str
    available: bool
    error: str | None = None
    report: dict | None = None


class PriceActionResponse(BaseModel):
    """/price-action."""

    symbol: str
    yfTicker: str
    signal: str
    severity: str
    reasons: list[str]
    spot: float | None
    sma50: float | None
    sma200: float | None
    pctVsSma50: float | None
    pctVsSma200: float | None
    pctOffHigh20: float | None
    atLow20: bool
    atHigh20: bool
    consecutiveDownDays: int
    consecutiveUpDays: int
    todayChangePct: float | None
    gapPct: float | None
    volRatio: float | None
    hv30: float | None
    hv60: float | None
    hvExpansion: float | None
    barsUsed: int


class TechnicalIndicatorsResponse(BaseModel):
    """/technical/indicators."""

    symbol: str
    yfTicker: str
    spot: float | None
    asOf: str | None
    barsUsed: int
    rsi14: float | None
    rsiState: str
    macd: float | None
    macdSignal: float | None
    macdHist: float | None
    bbUpper: float | None
    bbMid: float | None
    bbLower: float | None
    bbPctB: float | None
    sma20: float | None
    sma50: float | None
    sma200: float | None
    pctVsSma20: float | None
    pctVsSma50: float | None
    pctVsSma200: float | None
    high52w: float | None
    low52w: float | None
    pctOff52wHigh: float | None
    ret5d: float | None
    ret20d: float | None
    adx14: float | None
    plusDi: float | None
    minusDi: float | None
    regime: str
    rsiDivergence: str
    support: float | None
    resistance: float | None
    supportLevels: list[float]
    resistanceLevels: list[float]
    structureBias: str
    structureEvent: str
    structureDirection: str
    structureLevel: float | None


class VolRegimeResponse(BaseModel):
    """/vol/regime. All vol figures are decimals (0.41 = 41%)."""

    symbol: str
    yfTicker: str
    hv30: float | None
    hv30Pct: float | None
    hv30Low: float | None
    hv30High: float | None
    atmIv: float | None
    expiryUsed: str | None
    dte: int | None
    ivHv30: float | None
    chainError: str | None
    label: str
    sampleBars: int


class ChainStrike(BaseModel):
    """One quotable strike on one side of one expiry."""

    strike: float
    delta: float | None
    bid: float
    ask: float | None
    mid: float
    iv: float | None
    openInterest: float | None
    volume: float | None
    spreadPct: float | None


class ChainExpiry(BaseModel):
    """One expiry's puts and calls beyond the expected-move band."""

    expiry: str
    dte: int
    puts: list[ChainStrike]
    calls: list[ChainStrike]


class WheelChainResponse(BaseModel):
    """/options/wheel-chain."""

    symbol: str
    spot: float
    expiries: list[ChainExpiry]


class VolSummaryResponse(BaseModel):
    """/options/vol-summary. All vol figures are decimals (0.32 = 32%)."""

    symbol: str
    yfTicker: str
    spot: float
    expiry_used: str
    dte: int
    atm_iv: float | None
    atm_iv_call: float | None
    atm_iv_put: float | None
    atm_strike_call: float | None
    atm_strike_put: float | None
    hv_30: float | None
    hv_60: float | None
    iv_hv_ratio: float | None
    skew_25d: float | None
    skew_25d_call_strike: float | None
    skew_25d_put_strike: float | None
    hv_sample_size: int
