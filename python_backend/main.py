"""moomoo sidecar — market data, fundamentals, and deterministic indicators.

Everything here is computed in Python and cited verbatim upstream; nothing is
inferred by an LLM. Routes live in routers/, shared math in indicators.py and
levels.py, caching in store.py + bars.py.
"""

from fastapi import FastAPI

from routers import anomaly, fundamentals, health, market, research, technical, volatility

app = FastAPI(title="moomoo-sidecar")

app.include_router(health.router)
app.include_router(anomaly.router)
app.include_router(market.router)
app.include_router(fundamentals.router)
app.include_router(volatility.router)
app.include_router(technical.router)
app.include_router(research.router)
