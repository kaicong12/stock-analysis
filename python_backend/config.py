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

# Credit-spread screener. Gates ownership, not just premium: the short strike is
# a price to be assigned at and wheel.
SCR_MIN_CAP = 10_000_000_000
SCR_MIN_PRICE = 20
SCR_MIN_UL_VOLUME = 500_000
SCR_MIN_IVR = 0.50
# IVR alone passes names whose IV is high only because realized vol is too.
SCR_MIN_IV_HV = 1.20
SCR_DTE_MIN = 25
SCR_DTE_MAX = 45
SCR_MIN_OI = 1_000
SCR_MIN_OPT_VOLUME = 100
# ~1σ sits near |Δ| 0.16; a wider band only yields candidates the expected-move
# guard rejects anyway.
SCR_DELTA_LO = -0.18
SCR_DELTA_HI = -0.08
SCR_MIN_OTM_PROB = 0.80
SCR_MAX_SPREAD_PCT = 5.0
# IV rank needs a year of IV history to be defined at all.
SCR_MIN_LISTING_YEARS = 3
SCR_EXCHANGES = ("US_NYSE", "US_NASDAQ")
# Wide enough that an ordinary drawdown lands between the strikes, where
# assignment starts the wheel rather than hitting the long leg's cap.
SCR_WIDTH_PCT = 0.05
SCR_MIN_CREDIT_WIDTH = 0.15
SCR_SCREEN_MIN_GAP_S = 3.5

# True rejects any contract whose expiry window contains an FOMC decision;
# False keeps the candidate and reports the date in `fomcInWindow` instead.
# Meetings are 42-49 days apart, so a 45-day window contains one 97% of the time.
SCR_FOMC_HARD_VETO = True
