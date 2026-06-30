## Roadmap

### Upcoming

1. **Tighten anomaly lookback windows (drop already-priced-in events)**
   - ~~Insider Flow: reduce default `lookbackDays` 90 → 60~~ **Done (2026-06-27): set to 45** (`src/lib/massive/insider.ts:156`) to drop stale Form 4 trades the market has already absorbed
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

### Learning / research

1. **Understand MACD + the common "good-entry" indicator stack**
   - The app already computes these per ticker in `TechnicalIndicators` (`src/lib/types.ts`): `macd` (MACD line = EMA12 − EMA26), `macdSignal` (9-EMA of the MACD line), `macdHist` (macd − signal). Learn what each actually means before leaning on them in a verdict
   - MACD line significance: what the EMA12 − EMA26 spread represents (short-term vs longer-term momentum), why it oscillates around zero, and what "above/below the zero line" says about the prevailing trend
   - What technical traders read for general direction: the **MACD line vs signal-line crossover** (bullish when MACD crosses above signal, bearish below), the **histogram** as the early tell (momentum fading before the cross), and **zero-line crosses** as trend-regime confirmation. Note MACD is lagging — it confirms, it doesn't lead
   - Other common entry-timing indicators to study alongside it (most already in `TechnicalIndicators`): **RSI(14)** overbought/oversold + divergence, **Bollinger %B** (band position / squeeze), **ADX + ±DI** (is there a trend worth trading or just chop), moving-average stack (20/50/200 SMA alignment), and volume confirmation
   - Goal: a clear mental model of "is now a good entry" = trend direction (MACD zero-line + MA stack + ADX) × momentum timing (MACD cross/histogram + RSI) × confirmation (volume, divergence). Then sanity-check that the verdict/synth weighting of these matches the textbook reading
   - Whats SMA 200? Whats the technical significance