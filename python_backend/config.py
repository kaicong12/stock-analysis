"""Environment and tunable constants."""

import os
from pathlib import Path

OPEND_HOST = os.getenv("FUTU_OPEND_HOST", "127.0.0.1")
OPEND_PORT = int(os.getenv("FUTU_OPEND_PORT", "11111"))

DB_FILE = Path(__file__).resolve().parent.parent / "data" / "app.sqlite"

# Peer universe filter — mirrors the CLAUDE.md tradeable universe.
PEERS_MIN_CAP = 10_000_000_000
PEERS_MIN_PRICE = 20

# Breakdown / breakout confirmation thresholds. Named so the falling-knife
# guard's behaviour is auditable rather than buried in magic numbers.
BRK_DRAWDOWN_PCT = 10.0      # % off the 20d high that counts as broken down
BRK_VOL_RATIO = 1.5          # today volume / 20d avg that counts as heavy
BRK_GAP_PCT = 3.0            # |gap %| open vs prior close
BRK_RUN_DAYS = 3             # consecutive same-direction days
BRK_NEAR_EXTREME_PCT = 1.0   # within this % of the 20d low/high
BRK_SEVERE_GAP_PCT = 5.0
BRK_SEVERE_VOL_RATIO = 2.0

# Credit-spread screener. Stricter than the CLAUDE.md universe floor on purpose:
# the short strike is a price the user intends to be assigned at and then wheel,
# so these gate whether the stock is worth OWNING, not just whether the option
# is worth selling.
SCR_MIN_CAP = 10_000_000_000
SCR_MIN_PRICE = 20
SCR_MIN_UL_VOLUME = 500_000
SCR_MIN_IVR = 0.50
# IV must exceed realized by a real margin. IVR alone passes names whose IV is
# high only because the stock is actually moving that much — no premium there.
SCR_MIN_IV_HV = 1.20
SCR_DTE_MIN = 25
SCR_DTE_MAX = 45
SCR_MIN_OI = 1_000
SCR_MIN_OPT_VOLUME = 100
# ~1σ sits near |Δ| 0.16, and the short strike must clear the expected move, so
# a wider band would only produce candidates the level guard always rejects.
SCR_DELTA_LO = -0.18
SCR_DELTA_HI = -0.08
SCR_MIN_OTM_PROB = 0.80
SCR_MAX_SPREAD_PCT = 5.0
# IV rank needs a year of IV history to mean anything; a wheel needs a business
# with a track record. Three years covers both.
SCR_MIN_LISTING_YEARS = 3
SCR_EXCHANGES = ("US_NYSE", "US_NASDAQ")
# Wide enough that an ordinary drawdown still lands between the strikes, where
# assignment starts the wheel rather than hitting the long leg's cap.
SCR_WIDTH_PCT = 0.05
SCR_MIN_CREDIT_WIDTH = 0.15
SCR_SCREEN_MIN_GAP_S = 3.5

# FOMC meetings fall 42-49 days apart, so a 45-day expiry window contains one on
# 97% of start dates (30-day: 69%). As a hard veto this is close to an off
# switch rather than a filter. Left ON to match the CLAUDE.md binary-event rule
# as written; flip to False to demote FOMC to a flag while earnings — which is
# idiosyncratic, gaps a single name, and IS avoidable — stays a hard veto.
SCR_FOMC_HARD_VETO = True
