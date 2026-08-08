"""Option-chain helpers shared by /options/vol-summary and the wheel routes."""

import datetime as dt

# get_market_snapshot accepts at most 200 codes per call.
SNAPSHOT_CHUNK = 200


def nearest(rows: list[dict], key: str, target: float) -> dict | None:
    return min(rows, key=lambda r: abs(r[key] - target)) if rows else None


def pick_expiry(exp_rows: list[dict], today: dt.date, target_dte: int):
    """Future expiry closest to target_dte, as (iso_string, date)."""
    target_date = today + dt.timedelta(days=target_dte)
    chosen = None
    chosen_diff = None
    for r in exp_rows:
        s = r.get("strike_time")
        if not isinstance(s, str):
            continue
        try:
            d = dt.date.fromisoformat(s[:10])
        except ValueError:
            continue
        if d < today:
            continue
        diff = abs((d - target_date).days)
        if chosen_diff is None or diff < chosen_diff:
            chosen, chosen_diff = (s[:10], d), diff
    return chosen


def pick_expiries(exp_rows: list[dict], today: dt.date, target_dtes: list[int]):
    """One expiry per target DTE, de-duplicated and date-ordered. Nearby targets
    often resolve to the same contract, so collapsing them avoids a repeat fetch."""
    seen: dict[str, dt.date] = {}
    for target in target_dtes:
        chosen = pick_expiry(exp_rows, today, target)
        if chosen:
            seen[chosen[0]] = chosen[1]
    return sorted(seen.items(), key=lambda kv: kv[1])


def snapshot_by_code(ctx, codes: list[str]) -> dict[str, dict]:
    """Chunked get_market_snapshot keyed by option code."""
    from moomoo import RET_OK

    from util import normalize

    out: dict[str, dict] = {}
    for i in range(0, len(codes), SNAPSHOT_CHUNK):
        ret, snap = ctx.get_market_snapshot(codes[i:i + SNAPSHOT_CHUNK])
        if ret != RET_OK:
            raise RuntimeError(f"get_market_snapshot: {snap}")
        rows = normalize(snap) if snap is not None else []
        if isinstance(rows, list):
            for s in rows:
                c = s.get("code")
                if isinstance(c, str):
                    out[c] = s
    return out
