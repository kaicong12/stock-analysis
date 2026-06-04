#!/usr/bin/env python3
"""
Reproduction script for moomoo customer support.

Demonstrates that several documented `analysis_dimensions` of
`get_financial_unusual` and `get_derivative_unusual` return an undocumented
error `err_code = -12301` with an EMPTY `retMsg`, on both US and HK symbols,
while sibling dimensions on the same call succeed.

Because of this, a full scan (omitting `analysis_dimensions`, which the SDK
docstring says means "默认全部 / default all") fails entirely with -12301 —
a single failing dimension poisons the whole request.

Run:
    ~/.moomoo-venv/bin/python python_backend/debug_anomaly_support.py

Requires moomoo OpenD running and logged in (default 127.0.0.1:11111).
"""
import json
import os
import moomoo
from moomoo import OpenQuoteContext, RET_OK

HOST = os.getenv("FUTU_OPEND_HOST", "127.0.0.1")
PORT = int(os.getenv("FUTU_OPEND_PORT", "11111"))

# Canonical dimension names (from moomoo skill docs / API reference).
FINANCIAL_DIMS = [
    "funds_distribution", "funds_broker", "funds_flow",
    "short_sell_number", "short_sell_ratio", "short_sell_number_and_ratio",
]
DERIVATIVE_DIMS = [
    "warrant_ratio", "warrant_price_distribution", "option_unusual",
    "option_volatility", "option_volume_price", "option_sentiment",
    "option_comprehensive",
]
SYMBOLS = ["US.NVDA", "HK.00700"]
TIME_RANGE = 30
LANGUAGE_ID = 2  # 1=EN, 2=ZH-CN


def as_dict(data):
    """Normalize the SDK return (DataFrame or str/dict) to a plain dict/list."""
    if hasattr(data, "to_dict"):
        rec = data.to_dict(orient="records")
        return rec[0] if len(rec) == 1 else rec
    return data


def call(ctx, fn_name, symbol, dims):
    fn = getattr(ctx, fn_name)
    ret, data = fn(symbol, time_range=TIME_RANGE,
                   analysis_dimensions=dims, language_id=LANGUAGE_ID)
    rec = as_dict(data)
    err = rec.get("err_code") if isinstance(rec, dict) else None
    return {
        "function": fn_name,
        "symbol": symbol,
        "analysis_dimensions": dims,
        "ret": ret,
        "ret_is_RET_OK": ret == RET_OK,
        "response": rec,
        "err_code": err,
    }


def main():
    print(f"moomoo SDK version : {getattr(moomoo, '__version__', '?')}")
    print(f"OpenD endpoint     : {HOST}:{PORT}")
    ctx = OpenQuoteContext(host=HOST, port=PORT)
    try:
        ret, gs = ctx.get_global_state()
        print("get_global_state   :", {
            "ret": ret,
            "qot_logined": gs.get("qot_logined") if isinstance(gs, dict) else gs,
            "trd_logined": gs.get("trd_logined") if isinstance(gs, dict) else None,
            "server_ver": gs.get("server_ver") if isinstance(gs, dict) else None,
            "market_us": gs.get("market_us") if isinstance(gs, dict) else None,
            "market_hk": gs.get("market_hk") if isinstance(gs, dict) else None,
            "timestamp": gs.get("timestamp") if isinstance(gs, dict) else None,
        })
        print("=" * 88)

        results = []

        # 1) Full scan (omit dimensions) — the path the app uses. Fails -12301.
        for symbol in SYMBOLS:
            for fn in ("get_financial_unusual", "get_derivative_unusual"):
                r = call(ctx, fn, symbol, None)
                results.append(r)
                print(f"[FULL SCAN dims=None] {fn} {symbol}: "
                      f"ret={r['ret']} err_code={r['err_code']} "
                      f"response={json.dumps(r['response'], ensure_ascii=False)[:120]}")
        print("=" * 88)

        # 2) Per-dimension breakdown — isolates which dimensions error.
        for symbol in SYMBOLS:
            print(f"\n----- {symbol} : get_financial_unusual (per dimension) -----")
            for d in FINANCIAL_DIMS:
                r = call(ctx, "get_financial_unusual", symbol, [d])
                results.append(r)
                print(f"  {d:30s} err_code={str(r['err_code']):>6}  "
                      f"{json.dumps(r['response'], ensure_ascii=False)[:90]}")
            print(f"\n----- {symbol} : get_derivative_unusual (per dimension) -----")
            for d in DERIVATIVE_DIMS:
                r = call(ctx, "get_derivative_unusual", symbol, [d])
                results.append(r)
                print(f"  {d:30s} err_code={str(r['err_code']):>6}  "
                      f"{json.dumps(r['response'], ensure_ascii=False)[:90]}")

        # 3) Machine-readable dump for attaching to a support ticket.
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "anomaly_support_report.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump({
                "moomoo_sdk_version": getattr(moomoo, "__version__", "?"),
                "opend": f"{HOST}:{PORT}",
                "time_range": TIME_RANGE,
                "language_id": LANGUAGE_ID,
                "results": results,
            }, f, ensure_ascii=False, indent=2)
        print("\n" + "=" * 88)
        print(f"Full machine-readable report written to: {out}")
    finally:
        ctx.close()


if __name__ == "__main__":
    main()
