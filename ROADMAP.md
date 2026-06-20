## Roadmap

### Upcoming

1. **Manual Stock Digest override (rate-limit fallback)**
   - The grounded Stock Digest hits the Gemini daily rate limit too soon, knocking out a high-weight derivatives-sleeve input
   - Add a manual-entry mode: user pastes their own web-search results into the Digest panel as plain text
   - The pasted prose feeds the final verdict exactly like the auto digest (synth reads `prose` verbatim — see `compressPanel`), so the digest's high synth weight stays available
   - The existing `===SIGNAL===` / catalyst parser still runs on whatever the user pastes to infer short-term direction + catalysts (auto-direction); falls back to neutral when absent
   - No new synth wiring needed — the manual text travels the same `panels.digest` path

2. **Tighten anomaly lookback windows (drop already-priced-in events)**
   - Insider Flow: reduce default `lookbackDays` 90 → 60 (`src/lib/massive/insider.ts:156`) to drop stale Form 4 trades that the market has already absorbed
   - Capital Anomaly: already defaults to 30 days (`src/lib/moomoo/sidecar.ts:65`) — keep at 30. If stale dates still appear in the panel, investigate the moomoo `get_financial_unusual` output (anomaly events dated outside the window / report-text dates), NOT the lookback parameter
   - Optionally expose both windows as parameters later for per-run tuning

3. **Let Scanner include more useful filters**
   - `runCreditSpreadScanner` (`src/lib/ibkr/scanner.ts`) currently filters only price/volume/optVolume/marketCap. Add finance-grade filters that matter for a credit-spread book before a name even reaches the panels
   - Candidates: real IV Rank / IV Percentile threshold (IVR > 50 per CLAUDE.md), per-contract option liquidity (bid/ask width, open interest at the candidate strikes), and exclusion of names with earnings inside the expiry window
   - Goal: surface only names that are already tradeable for defined-risk premium selling, instead of post-filtering downstream

4. **Portfolio-level aggregate risk view (net delta / vega / concentration)**
   - Today every verdict is computed per-ticker in isolation; sizing is capped per trade (~1.5% NAV max loss) but nothing aggregates risk across the book
   - Add a book-level rollup: beta-weighted net delta, total short vega, and name/sector concentration across all open derivatives + stock positions
   - Selling premium across several correlated mega-caps is one concentrated short-vol / short-correlation bet — diversified in ticker count, not in risk. Surface this so the "conservative" sizing holds at the portfolio level, not just per trade
   - Feeds a soft gate: warn when adding a new short-premium position pushes aggregate short vega or single-sector exposure past a threshold
