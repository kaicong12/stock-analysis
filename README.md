# stock-analysis

A wheel-entry desk for one ticker at a time. You bring a company you already want to own; the app answers **is this a good price, and where do I sell the put.**

Eight panels run in parallel — each one LLM call over a focused slice of data — and a final synth call turns them into a dual-sleeve verdict: a stock action and a wheel action. All deterministic math (indicators, levels, vol, the option chain) is computed by a Python sidecar and cited verbatim; the model never recomputes it.

**No broker integration**, deliberately — no account, NAV, cash, or position data, and it never asks for any. Both sleeves are **entry-or-pass on a fresh position**, and no output ever states a size. See `CLAUDE.md` for the trading profile.

## Run it

Two processes. moomoo OpenD must be running on `127.0.0.1:11111`.

```bash
pnpm dev:all      # OpenD precheck + sidecar + Next, one Ctrl-C stops both
```

Or separately: `pnpm dev:sidecar` (FastAPI, from `~/.moomoo-venv`) and `pnpm dev` (Next → localhost:3000).

Tests: `pnpm test` (vitest — wheel scoring and acquisition zone) and `cd python_backend && pytest` (indicator math; `pip install -r requirements-dev.txt`). CI runs both plus `tsc --noEmit` and `eslint` on every push and PR (`.github/workflows/tests.yml`).

### Environment

Repo-root `.env` (also sourced by `scripts/dev.sh`). Definitions live in `src/lib/env.ts`.

| Var | |
|---|---|
| `OPENROUTER_API_KEY` | **Required.** The panel/synth LLM. `OPENROUTER_MODEL` defaults to `google/gemini-3.1-flash-lite-preview` |
| `GEMINI_API_KEY` | Web-grounded surfaces (Stock Digest, macro briefing). `GEMINI_GROUNDED_MODEL` defaults to `gemini-2.5-flash` |
| `MASSIVE_API_KEY` | SEC Form 4 insider data; the panel degrades to "no activity" when unset |
| `PYBACKEND_URL` | Sidecar, default `http://localhost:8765` |
| `FUTU_OPEND_HOST` / `FUTU_OPEND_PORT` | OpenD, default `127.0.0.1:11111` (read by the sidecar) |
| `SYNTH_DEBUG` | Any non-empty value logs the full synth payload and the raw pre-override model output |

## Pipeline

```mermaid
flowchart TD
    A["POST /api/prep<br/>snapshot + earnings pre-flight"] --> S0{"ticker recognized?"}
    S0 -- no --> R["404 TICKER_NOT_FOUND"]
    S0 -- yes --> S2["8 × POST /api/panel/[name]<br/>(parallel, 7 LLM calls)"]
    S2 --> S3["POST /api/verdict (1 LLM call)<br/>panels + priceAction + indicators + wheel plan + macro"]
    S3 --> OUT["Verdict: stock sleeve + wheel sleeve"]
```

Every step renders the moment it resolves: `src/app/page.tsx` fans the eight panel requests out concurrently and dispatches each result as it lands, so panels fill in one by one rather than waiting on the slowest. Earnings inside the 45-day window pause the run before any LLM call and ask for confirmation.

**Storage:** one SQLite file, `data/app.sqlite`, owned entirely by the sidecar (`store.py`). It caches yfinance daily bars so HV and price action don't refetch per request. Fully rebuildable — delete it and the sidecar repopulates.

## Panels

| Panel | Source | Reads |
|---|---|---|
| **Fundamentals** | yfinance via sidecar | Valuation, growth, margins, balance sheet, analyst targets, earnings + ex-div dates. Also supplies the earnings date the gate uses. |
| **Wheel Entry** | OpenD chain + sidecar | Expected move per expiry, the strikes beyond it, the acquisition zone, the vol regime. **No LLM call** — see below. |
| **Technical** | moomoo `get_technical_unusual` + computed indicators | Anomaly *events* (K-line patterns, indicator crosses) plus standing *state*: RSI, MACD, Bollinger %B, SMA distances, ADX/±DI, a `regime` label, `rsiDivergence`. The anomaly feed often reads 无异常 while the chart is plainly extended; the snapshot fills that gap. |
| **Capital** | moomoo `get_financial_unusual` | Capital distribution, broker flow, net in/outflow, short selling. |
| **News Flow** | Morningstar report (OpenD) + peer graph | Fair value, moat, bull/bear, analyst note — the self-signal. Peer headlines ride alongside as a separate sector read-through block, never mixed into the ticker's own signal. |
| **Stock Digest** | Gemini, web-grounded | Browses live; broker reports and analyst notes on the near-term setup. |
| **Community Sentiment** | moomoo community feed (public web API) | Retail tone — a contra-indicator at extremes. |
| **Insider Flow** | SEC Form 4 via Massive | Discretionary buys/sells only; routine 10b5-1 plan sales are discounted. |

## The wheel read

Three deterministic pieces, computed before any LLM sees them.

**Acquisition zone** (`src/lib/wheel/zone.ts`) — the band of prices worth owning at, bracketed from three anchors: analyst target-low, SMA200, nearest swing support. Each is reported individually so you can dismiss one. A put strike below the band is a *good* acquisition price, inside is *fair*, above is *rich* — you'd be overpaying to get assigned. The call leg inverts: above the band is good, because you're selling richly.

**Vol regime** (`/vol/regime`) — HV30 with its own trailing-1-year percentile, plus ATM IV and IV/HV, labelled `rich` / `fair` / `thin`. This is a **proxy for IV Rank, not IV Rank**: no available source carries historical implied vol, so the percentile ranks *realized* vol. Everything that surfaces it says so. Thin premium is a downgrade, never a veto.

**Strike tables** (`/options/wheel-chain` + `src/lib/wheel/score.ts`) — expiries near 21/30/45 DTE, each showing the 1-SD expected move and **only the strikes beyond it**, nearest the band edge first, capped at 8. The expected move *is* the filter, computed per expiry from that expiry's own ATM IV since vol is DTE-specific. Each row carries delta, bid, mid, zone position, whether it clears support/resistance, and **annualized yield %** = `mid/basis × 365/dte`, where basis is the strike on the put leg (cash secured) and spot on the call leg (shares already owned) — size-independent either way.

Liquidity is **not** a gate: a thin far-OTM strike is still a legitimate entry, so OI and spread aren't filtered on. An expiry with earnings inside its window is dropped in code. There's deliberately **no composite score** and no "best strike" mark — further out is safer and pays less, and that tradeoff is the read.

## The verdict

One LLM call reads all eight panels; `src/lib/gemini/synth.ts` sets the reasoning order — acquisition price first, then the breakdown state, the regime read, vol as a bonus, strike placement, a mandatory earnings cite, and a rationale that has to quote actual numbers.

Three of those are **also enforced in code**, so a model that argues around the prompt still gets overridden:

- **Severe breakdown → PASS** on the put leg. A mild breakdown only annotates the instruction and requires the strike below the zone floor.
- **Breakout → PASS** on the covered call. Not capping upside into a melt-up.
- **`stripSizingPhrases()`** scrubs any "% NAV", contract count, or share count that slips into either instruction.

Each sleeve carries its **own confidence on its own clock**: stock is the multi-quarter thesis, wheel is "is this price a good entry". A 75% long-term hold at a 45% entry is the normal split between a good company and a good price — not disagreement, and never averaged.
