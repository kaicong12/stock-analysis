## Roadmap

### Upcoming

1. **Earnings-first pre-search gate**
   - Before spending any Gemini calls on the 8 AI panels, fetch ONLY the cheap yfinance earnings date (sidecar `/fundamentals`) and display it up front
   - If `earningsDaysAway` ≤ 45 (inside the 30-45 DTE expiry window + the "no binary events in the expiry window" rule), surface a warning/confirm gate and STOP before running the full panel search
   - User can override ("continue anyway") to proceed with the AI panels when they still want the analysis
   - Saves API spend on names the user would skip anyway, and enforces the conservative no-binary-events-in-expiry-window discipline at the top of the funnel

2. **Manual Stock Digest override (rate-limit fallback)**
   - The grounded Stock Digest hits the Gemini daily rate limit too soon, knocking out a high-weight derivatives-sleeve input
   - Add a manual-entry mode: user pastes their own web-search results into the Digest panel as plain text
   - The pasted prose feeds the final verdict exactly like the auto digest (synth reads `prose` verbatim — see `compressPanel`), so the digest's high synth weight stays available
   - The existing `===SIGNAL===` / catalyst parser still runs on whatever the user pastes to infer short-term direction + catalysts (auto-direction); falls back to neutral when absent
   - No new synth wiring needed — the manual text travels the same `panels.digest` path

3. **Tighten anomaly lookback windows (drop already-priced-in events)**
   - Insider Flow: reduce default `lookbackDays` 90 → 60 (`src/lib/massive/insider.ts:156`) to drop stale Form 4 trades that the market has already absorbed
   - Capital Anomaly: already defaults to 30 days (`src/lib/moomoo/sidecar.ts:65`) — keep at 30. If stale dates still appear in the panel, investigate the moomoo `get_financial_unusual` output (anomaly events dated outside the window / report-text dates), NOT the lookback parameter
   - Optionally expose both windows as parameters later for per-run tuning

### Done

- Support, resistance, and structural change levels (handled by Technical Anomaly panel)
- Web-grounded Stock Digest panel (Gemini + Google Search, short-term sentiment + direction signal)
- Macro Environment panel — current regime + forward-looking calendar (next ~60 days: FOMC/CPI/PPI/NFP/GDP/PCE with dates); one shared Gemini + Google Search call per batch, 6h TTL cache; flows to synth as ambient context so the derivatives sleeve sees upcoming vol events
- 8-panel architecture (capital, technical, derivatives, news, digest, sentiment, fundamentals, insider)
- Dual-sleeve synth verdict (stock + derivatives) with conservative trader gates