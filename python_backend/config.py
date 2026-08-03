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
