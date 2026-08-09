"""Environment and tunable constants."""

import os
from pathlib import Path

OPEND_HOST = os.getenv("FUTU_OPEND_HOST", "127.0.0.1")
OPEND_PORT = int(os.getenv("FUTU_OPEND_PORT", "11111"))

DB_FILE = Path(__file__).resolve().parent.parent / "data" / "app.sqlite"

# Read-through peer graph only — CLAUDE.md forbids screening the user's ticker.
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

# Wheel strategy. The vol regime is a BONUS for a wheeler who wants the shares,
# not a gate — thin premium means you're paid less to wait, not that you pass.
WHEEL_TARGET_DTES = [21, 30, 45]
WHEEL_ATM_SAMPLE = 0.05      # ± fraction of spot sampled to read the expiry's ATM IV
WHEEL_ROWS_PER_SIDE = 12     # strikes quoted past each band edge (the UI shows 8)
WHEEL_HV_PCT_RICH = 50.0     # HV30 trailing-1yr percentile that reads elevated
WHEEL_IV_HV_RICH = 1.15      # IV/HV30 at which implied is meaningfully rich
WHEEL_HV_MIN_SAMPLE = 150    # below this many ranked bars the percentile is n/a
