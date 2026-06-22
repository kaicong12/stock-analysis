## Roadmap

### Upcoming

1. **Tighten anomaly lookback windows (drop already-priced-in events)**
   - Insider Flow: reduce default `lookbackDays` 90 → 60 (`src/lib/massive/insider.ts:156`) to drop stale Form 4 trades that the market has already absorbed
   - Capital Anomaly: already defaults to 30 days (`src/lib/moomoo/sidecar.ts:65`) — keep at 30. If stale dates still appear in the panel, investigate the moomoo `get_financial_unusual` output (anomaly events dated outside the window / report-text dates), NOT the lookback parameter
   - Optionally expose both windows as parameters later for per-run tuning

2. **Let Scanner include more useful filters**
   - `runCreditSpreadScanner` (`src/lib/ibkr/scanner.ts`) currently filters only price/volume/optVolume/marketCap. Add finance-grade filters that matter for a credit-spread book before a name even reaches the panels
   - Candidates: real IV Rank / IV Percentile threshold (IVR > 50 per CLAUDE.md), per-contract option liquidity (bid/ask width, open interest at the candidate strikes), and exclusion of names with earnings inside the expiry window
   - Goal: surface only names that are already tradeable for defined-risk premium selling, instead of post-filtering downstream

3. **Portfolio-level aggregate risk view (net delta / vega / concentration)**
   - Today every verdict is computed per-ticker in isolation; sizing is capped per trade (~1.5% NAV max loss) but nothing aggregates risk across the book
   - Add a book-level rollup: beta-weighted net delta, total short vega, and name/sector concentration across all open derivatives + stock positions
   - Selling premium across several correlated mega-caps is one concentrated short-vol / short-correlation bet — diversified in ticker count, not in risk. Surface this so the "conservative" sizing holds at the portfolio level, not just per trade
   - Feeds a soft gate: warn when adding a new short-premium position pushes aggregate short vega or single-sector exposure past a threshold
