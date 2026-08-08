## Roadmap

### Upcoming

1. **Verify the wheel data against a live OpenD session** — the chain, delta, bid/ask, OI, and the vol-regime percentile have never run against real quotes. Check per-strike `mid` and `annYield` against the broker, and confirm `/vol/regime` returns a sane percentile on a name with a full year of bars.
2. **Consider Morningstar fair value as a fourth acquisition-zone anchor** — `getMorningstar` already returns `fairValue`, and it's arguably a better "worth owning at" anchor than analyst target-low. Would need a rule for when the two disagree materially.
3. **Tighten anomaly lookback windows** — insider flow is at 45 days (`src/lib/massive/insider.ts`), capital anomaly at 30 (`src/lib/moomoo/sidecar.ts`). If stale dates still appear in the capital panel, investigate the moomoo `get_financial_unusual` output rather than the lookback parameter.

### Learning / research

1. **The indicator stack behind "is now a good entry"**
   - Already computed per ticker in `TechnicalIndicators`: `macd` (EMA12 − EMA26), `macdSignal` (9-EMA of it), `macdHist` (the difference).
   - MACD: what the EMA spread represents, why it oscillates around zero, what above/below the zero line says about trend. The **line/signal crossover** is the entry tell, the **histogram** the earlier one (momentum fading before the cross), and **zero-line crosses** confirm the regime. It lags — it confirms, it doesn't lead.
   - Alongside it: **RSI(14)** extremes and divergence, **Bollinger %B** (band position, squeeze), **ADX + ±DI** (is there a trend worth trading or just chop), the 20/50/200 SMA stack, and volume confirmation.
   - Goal: a mental model of entry = trend direction (MACD zero-line + MA stack + ADX) × timing (MACD cross/histogram + RSI) × confirmation (volume, divergence), then sanity-check that the synth's weighting matches the textbook reading.
   - **SMA200** specifically: why it's the conventional long-term trend line, and why it earns a place as an acquisition-zone anchor.

2. **Wheel mechanics worth internalizing**
   - Why delta ≈ assignment probability, and where that approximation breaks down.
   - Assignment timing on American-style options: early exercise is rare except into ex-dividend, which is why the ex-div guard applies only to short calls.
   - What annualized yield does and doesn't tell you — it assumes you can repeat the trade, which a wheel that gets assigned cannot.
