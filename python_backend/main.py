"""moomoo sidecar app — mounts every router."""

from fastapi import FastAPI

from routers import (
    anomaly, fundamentals, health, market, research, tape, technical, volatility, wheel,
)

app = FastAPI(title="moomoo-sidecar")

app.include_router(health.router)
app.include_router(anomaly.router)
app.include_router(market.router)
app.include_router(fundamentals.router)
app.include_router(volatility.router)
app.include_router(technical.router)
app.include_router(research.router)
app.include_router(tape.router)
app.include_router(wheel.router)
