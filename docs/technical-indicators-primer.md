# Technical Indicators Primer — MACD and the "Good Entry" Stack

A walk-through of the momentum/trend indicators this app already computes in
`TechnicalIndicators` (`src/lib/types.ts`), written for a conservative
credit-spread seller. The goal is a clear mental model of **"is now a good entry,
and which side do I sell?"**

> **On the prices below:** real *levels* and real historical *episodes* are used
> for grounding (e.g. AAPL's 2023 recovery, the 2022 bear market). Where the math
> is worked step-by-step, the short daily series is a **representative path around
> those real levels** so every number is exact and you can reproduce it — it is
> not tick-exact history. Sections labelled *(illustrative)* are constructed for
> teaching; sections labelled *(worked, exact)* are arithmetic you can verify.

---

## 0. The mental model first

No single indicator tells you to enter. A good entry decision is three questions
stacked, in this order:

| Question | What answers it | App fields |
|---|---|---|
| **1. Is there a trend, and which way?** | Moving-average stack + ADX/±DI + MACD zero line | `sma20/50/200`, `adx14`, `plusDi`, `minusDi`, `regime`, `macd` |
| **2. Is momentum timing the entry?** | MACD cross + histogram, RSI | `macd`, `macdSignal`, `macdHist`, `rsi14`, `rsiState`, `rsiDivergence` |
| **3. Is it confirmed?** | Volume, Bollinger position, divergence | `bbPctB`, `rsiDivergence`, (volume via price-action) |

Direction (Q1) decides **which side of premium you sell**; timing/confirmation
(Q2/Q3) decides **whether now, or wait**. For a premium seller the most expensive
mistake is selling *into* a move — so Q1 (trend) outranks a single oscillator
reading, which is exactly why the verdict's price-action breakdown guard
overrides a lone "oversold" technical read.

---

## 1. The building block: EMA (exponential moving average)

MACD, RSI's smoothing, and the signal line are all EMAs, so start here.

An EMA is a moving average that weights **recent prices more heavily** than old
ones, so it turns faster than a simple average (SMA). The recursion:

```
EMA_today = k × Price_today + (1 − k) × EMA_yesterday
where  k = 2 / (N + 1)        (the "smoothing factor")
```

A larger `N` → smaller `k` → smoother, slower line.

### Worked example, exact — EMA(5), so k = 2/6 = 0.3333

Seed the first EMA with the simple average of the first 5 closes, then apply the
recursion:

| Day | Close | EMA(5) calc | EMA(5) |
|----:|------:|---|------:|
| 1–5 | 100, 102, 101, 103, 104 | SMA seed = (100+102+101+103+104)/5 | **102.00** |
| 6 | 106 | 0.3333×106 + 0.6667×102.00 | **103.33** |
| 7 | 105 | 0.3333×105 + 0.6667×103.33 | **103.89** |
| 8 | 108 | 0.3333×108 + 0.6667×103.89 | **105.26** |
| 9 | 110 | 0.3333×110 + 0.6667×105.26 | **106.84** |

Notice on day 9 the price is **110** but the EMA is **106.84** — the EMA *lags*
price. That lag is the whole point: it filters noise. MACD uses EMA(12) and
EMA(26); same mechanic, just more data points.

---

## 2. MACD — Moving Average Convergence Divergence

Three numbers, all derived from EMAs of the closing price:

```
MACD line   = EMA(12) − EMA(26)      → field `macd`
Signal line = EMA(9) of the MACD line → field `macdSignal`
Histogram   = MACD line − Signal line → field `macdHist`
```

### What each part *means*

**MACD line (`macd`) — momentum / trend pressure.**
It's the gap between a fast EMA and a slow EMA.
- **MACD > 0** (above the zero line): the 12-day average is above the 26-day →
  short-term momentum is stronger than the medium-term baseline → **uptrend bias**.
- **MACD < 0**: the reverse → **downtrend bias**.
- The zero line is the trend divider; the *distance* from zero is how strong the
  momentum is.

**Signal line (`macdSignal`) — a smoothed lag of the MACD line.**
It exists only to generate crossovers. When the MACD line pulls away from its own
smoothed version, momentum is accelerating.

**Histogram (`macdHist`) — the early-warning bar.**
`macd − signal`. It crosses zero *before* the two lines visibly diverge, so it's
the first tell that momentum is shifting. Rising histogram = momentum building;
shrinking histogram = momentum fading even if price still rises.

### The three signals traders actually read, in order of significance

1. **Zero-line cross (strongest, slowest)** — MACD crossing from below 0 to above
   0 confirms a *trend regime* flip to bullish (and vice-versa). This is the
   "general direction" read.
2. **Signal-line crossover (faster, noisier)** — MACD crossing above its signal =
   bullish momentum trigger; below = bearish. Earlier than the zero-line cross but
   produces more false signals, especially in a flat/choppy market.
3. **Histogram flip (earliest)** — the histogram turning positive/negative is the
   leading hint that a signal-line cross is coming.

### Worked progression *(illustrative values around real AAPL ~$178→$194 levels, like its early-2023 base-and-turn)*

A stock bottoming out of a downtrend and turning up:

| Day | Close | EMA12 | EMA26 | MACD | Signal | Hist | What it says |
|----:|------:|------:|------:|------:|------:|------:|---|
| 1 | 178 | 180.5 | 184.0 | −3.5 | −2.9 | −0.6 | Downtrend: MACD below 0 **and** below signal |
| 2 | 180 | 180.4 | 183.7 | −3.3 | −2.98 | −0.32 | Histogram shrinking → down-momentum fading |
| 3 | 183 | 180.8 | 183.6 | −2.8 | −2.95 | **+0.15** | **Histogram flips + signal-line cross** (early bullish, still below 0) |
| 4 | 186 | 181.6 | 183.8 | −2.2 | −2.8 | +0.6 | Momentum building |
| 5 | 189 | 182.7 | 184.2 | −1.5 | −2.5 | +1.0 | Climbing toward zero |
| 6 | 191 | 184.0 | 184.7 | −0.7 | −2.1 | +1.4 | Almost at the zero line |
| 7 | 193 | 185.4 | 185.3 | **+0.1** | −1.7 | +1.8 | **Zero-line cross → trend confirmed bullish** |
| 8 | 194 | 186.7 | 185.9 | +0.8 | −1.2 | +2.0 | Established uptrend, strong momentum |

Reading it: the **signal-line cross on day 3** was the early entry trigger; the
cautious confirmation came on **day 7** when MACD cleared zero. A trader wanting
confirmation over speed waits for day 7; one wanting an earlier fill acts on day 3
and uses the zero line as the "I was wrong" level.

### The one caveat that matters

**MACD is a *lagging* indicator** — it's built from averages of past prices, so it
**confirms** a move, it does not predict one. In a sideways chop it whipsaws (lots
of false crossovers). That's why you gate it with a trend-strength filter (ADX,
next) before trusting a cross.

---

## 3. RSI(14) — Relative Strength Index (`rsi14`, `rsiState`, `rsiDivergence`)

RSI measures the *speed* of gains vs losses over 14 bars, scaled 0–100:

```
RSI = 100 − 100 / (1 + RS),   RS = (avg gain over 14) / (avg loss over 14)
```

- **≥ 70 → overbought**, **≤ 30 → oversold**, 30–70 neutral (`rsiState`).

### Worked example, exact

- Strong rally: avg gain 1.2, avg loss 0.6 → RS = 2.0 → RSI = 100 − 100/3 =
  **66.7** (strong, not yet overbought).
- Sharp selloff: avg gain 0.3, avg loss 1.1 → RS = 0.273 → RSI = 100 − 100/1.273 =
  **21.4** (oversold).

### The trap — and `rsiDivergence`

"Oversold" does **not** mean "buy." In a strong downtrend a stock can sit oversold
for weeks (it bleeds lower the whole way — this is the falling-knife trap). RSI is
only a reliable *reversal* tell when it **diverges** from price:

- **Bullish divergence** (`rsiDivergence: "bullish"`): price makes a lower low but
  RSI makes a higher low → selling pressure is exhausting → genuine turn more likely.
- **Bearish divergence** (`"bearish"`): price higher high, RSI lower high →
  buying exhausting.

That's why the app carries `rsiDivergence` separately from `rsiState`: the bare
overbought/oversold reading is noise inside a trend; the divergence is the signal.

---

## 4. Bollinger Bands %B (`bbUpper/bbMid/bbLower`, `bbPctB`)

Bands are a 20-day SMA (`bbMid`) ± 2 standard deviations. `%B` places price within
them:

```
%B = (Price − Lower) / (Upper − Lower)
```

- `%B > 1` price above the upper band, `< 0` below the lower, 0.5 = midline.

### Worked example, exact *(around real AAPL ~$188–196 levels)*

20-day SMA = 188, upper = 196, lower = 180, price = 194:

```
%B = (194 − 180) / (196 − 180) = 14 / 16 = 0.875
```

Upper third of the range — strong, but stretched toward the band. Two uses:
- **Position:** near the upper band = strong/extended; near lower = weak/extended.
- **Squeeze:** when the bands *narrow* (low volatility), a big move often follows.
  A breakout from a squeeze on volume is a classic entry trigger. (For a premium
  seller a squeeze is a warning — IV is low, so credit is thin; ties to the IV-HV
  discount guard.)

---

## 5. ADX + ±DI (`adx14`, `plusDi`, `minusDi`, `regime`) — the trend-strength gate

This is the filter that makes everything else trustworthy. It answers: **is there
a trend worth trading, or just chop?**

- **ADX** = trend *strength* only (not direction): `< 20` no/weak trend (range),
  `≥ 25` trending, `≥ 35` strong trend.
- **+DI vs −DI** = trend *direction*: `+DI > −DI` → up-pressure; `−DI > +DI` →
  down-pressure.

The app folds these into `regime` (`strong_uptrend / uptrend / range / downtrend /
strong_downtrend`).

### Why it gates the others

- **ADX < 20 (range):** MACD crossovers whipsaw — *low* confidence; RSI
  overbought/oversold mean-reversion is *more* reliable (fade the extremes).
- **ADX ≥ 25 (trend):** trust MACD crossovers in the trend direction; do **not**
  fade RSI extremes (an overbought strong-uptrend can stay overbought for weeks).

Example: ADX 32, +DI 28, −DI 15 → strong uptrend. An RSI of 75 here is **not** a
short signal — it's trend strength. Selling call premium into that (or buying puts)
is fighting the tape.

---

## 6. Moving-average stack (`sma20/50/200`, `pctVsSma*`)

The cheapest trend read: where price sits relative to the 20/50/200-day SMAs and
how they're stacked.

- **Bullish alignment:** price > SMA20 > SMA50 > SMA200 (fast above slow).
- **Bearish alignment:** the inverse.
- **Golden cross:** SMA50 crosses above SMA200 → long-term bullish regime.
  **Death cross:** the inverse (the 2022 bear market flashed a death cross on the
  S&P around March 2022 — SPY ~$430 — well before the October ~$348 bottom; a slow
  but correct regime warning).
- **200-day SMA** is the institutional line in the sand — above it = long-term
  uptrend intact.

---

## 7. Volume — the confirmation layer

Price moves on **above-average volume** are believed; moves on thin volume are
suspect. A MACD bullish cross *and* a breakout candle on >1.5× average volume is a
confirmed entry; the same cross on light volume is a maybe. (This app's
deterministic price-action signal already factors `volRatio`, gap, and
consecutive-day counts — see `PriceAction`.)

---

## 8. Putting it together — "is now a good entry?" scorecard

Score the three layers; you want **alignment**, not a single green light.

| Layer | Bullish-entry checklist |
|---|---|
| **Trend (Q1)** | Price > SMA50 > SMA200; ADX ≥ 25 with +DI > −DI; MACD > 0 (or just crossed) |
| **Timing (Q2)** | MACD signal-line cross up / histogram turning positive; RSI rising from a higher low, not already > 70 |
| **Confirm (Q3)** | Move on >1.5× avg volume; %B in upper half but not pinned > 1; bullish (not bearish) divergence |

### Worked judgement *(illustrative, AAPL-like ~$190)*

> Price 191, SMA50 186, SMA200 178 → bullish stack. ADX 27, +DI 26 > −DI 14 →
> confirmed uptrend. MACD just crossed its signal at −0.7 and the histogram is
> +1.4 and growing → momentum turning up but not yet through zero. RSI 61, rising
> off a higher low → room before overbought. %B 0.70. Volume 1.6× average on the
> turn.

**Verdict:** trend up + momentum turning + confirmed = a clean *bullish* read.
For a stock buyer, an entry with the zero-line cross as the invalidation level.

**For this book (credit spreads):** a clean bullish read means **sell put-side
premium** (bull put spread / CSP), *not* call-side — you sell the side the trend is
moving *away from*. Then place the short strike **beyond both the expected move and
support** (see `docs`/the Held-Options levels panel), and confirm no earnings
inside the expiry. The technicals pick the **side and the conviction**; the
expected-move + strike-placement rule keeps you from selling too close.

A reading where the layers **disagree** (e.g. MACD cross up but ADX 14 and price
below the 200-day) is a *pass*, not a trade — that's chop, where MACD whipsaws.

---

## 9. How this maps to the app

Everything above is computed server-side in `TechnicalIndicators`
(`src/lib/types.ts`, via the sidecar's `/technical/indicators`) and fed to the
verdict synth, which weights trend `regime` over lone oscillator extremes and lets
the deterministic price-action guard override an "oversold rebound" read during a
confirmed breakdown. The Held-Options levels panel (`/api/levels`) then turns the
direction call into the concrete "is my short strike still safe?" check.

| Concept here | App field(s) |
|---|---|
| MACD line / signal / histogram | `macd`, `macdSignal`, `macdHist` |
| RSI + state + divergence | `rsi14`, `rsiState`, `rsiDivergence` |
| Bollinger position | `bbUpper`, `bbMid`, `bbLower`, `bbPctB` |
| Trend strength/direction/regime | `adx14`, `plusDi`, `minusDi`, `regime` |
| MA stack | `sma20/50/200`, `pctVsSma20/50/200` |
| Support/resistance + structure | `support`, `resistance`, `structureBias`, `structureEvent` |

---

*Educational notes on indicator mechanics, not investment advice. Indicators
describe past price; none predicts the future, and all of them whipsaw in a
trendless market.*
