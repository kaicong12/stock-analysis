# Fundamentals — what to look at when buying a stock

A practical reference for the long-horizon "is this a good company at a fair price" question. Pair this with the dashboard's [Fundamentals panel](../src/lib/gemini/panels/fundamentals.ts) — which surfaces all of these from yfinance — and the synth's verdict logic.

The TL;DR: **a stock is a fractional claim on a business**. You're not buying a ticker, you're buying a slice of future cash flows. Every metric below answers one of three questions:

1. Is the business **growing**?
2. Is it **profitable** (and getting more so)?
3. Is the **price reasonable** for what you're getting?

Everything else is detail.

---

## The 7 buckets

| Bucket | What it answers | Top metrics |
|---|---|---|
| **1. Valuation** | Am I overpaying? | P/E (trailing & forward), PEG, P/B, P/S, EV/EBITDA |
| **2. Growth** | Is the business expanding? | Revenue YoY, EPS YoY, EPS QoQ |
| **3. Profitability** | Does growth become cash? | Profit margin, operating margin, ROE, ROIC |
| **4. Balance sheet** | Can it survive a downturn? | Debt-to-equity, current ratio, FCF, cash position |
| **5. Capital allocation** | What does management do with profits? | Buybacks, dividends, payout ratio, R&D spend |
| **6. Quality / moat** | Does the advantage persist? | Gross margin stability, ROIC vs cost of capital, market share |
| **7. Calendar / catalysts** | What might move the price soon? | Next earnings date, dividend ex-date, product launches |

The rest of this doc walks through each.

---

## 1. Valuation — "am I overpaying?"

Valuation is **always relative**. A P/E of 30 is expensive for a bank, cheap for a high-growth software company. Compare to:

- The **stock's own history** (last 5y average).
- **Peers in the same sector**.
- The **market** (S&P 500 trailing P/E hovers around 20).

### P/E ratio (Price ÷ Earnings)

The headline number. How much you pay per dollar of profit.

- **Trailing P/E**: based on last 12 months earnings. Backward-looking, accurate.
- **Forward P/E**: based on next 12 months estimates. Forward-looking, optimistic-biased.
- **Gap matters**: if forward P/E << trailing P/E, the market expects earnings to surge. If forward >> trailing, market expects earnings to fall.

**Rules of thumb:**

| Sector | Typical P/E |
|---|---|
| Banks | 8-12 |
| Utilities | 15-20 |
| Consumer staples | 20-25 |
| Industrials | 15-25 |
| S&P 500 average | ~20 |
| Tech (mature) | 25-35 |
| Tech (high growth) | 40-100+ |
| Biotech (pre-revenue) | N/A — earnings negative |

**P/E trap:** a low P/E can mean cheap *or* the market expects earnings to fall. Always check forward P/E and the growth trajectory.

### PEG ratio (P/E ÷ growth rate)

P/E adjusted for growth. A P/E of 40 is fine if earnings grow 40%/yr (PEG 1.0). The same P/E is expensive at 10% growth (PEG 4.0).

- **PEG < 1.0**: traditionally "cheap relative to growth."
- **PEG 1.0-2.0**: fair.
- **PEG > 2.0**: expensive unless growth accelerates.

**Caveat:** PEG breaks for low-growth or no-growth names — a utility with 2% growth and P/E 15 has PEG 7.5, which doesn't mean expensive.

### Price/Book (P/B)

Price ÷ shareholders' equity per share. Useful for asset-heavy businesses (banks, insurers, real estate).

- **P/B < 1.0**: trading below book. Value or distressed (look at why).
- **P/B 1-3**: normal.
- **P/B > 3**: market values intangibles or growth. Less meaningful for asset-light businesses (software).

### Price/Sales (P/S)

Price ÷ revenue per share. Useful when earnings are negative or volatile (early-stage, cyclical bottom).

- **P/S < 1**: low for any sector.
- **P/S 2-5**: typical for established companies.
- **P/S 10+**: high — only justified by very high gross margins + high growth.

### EV/EBITDA

Enterprise Value ÷ EBITDA. Strips out capital structure (debt vs. equity) — better than P/E when comparing companies with different debt loads.

- Used heavily in M&A. Not in the yfinance fundamentals panel by default.

---

## 2. Growth — "is the business expanding?"

Growth is the engine. A profitable business that doesn't grow becomes worth less every year (inflation eats it).

### Revenue growth (YoY)

Year-over-year top-line expansion. The cleanest signal of "is the business reaching more customers?"

- **> 20% YoY**: high-growth. Sustainable for ~5-10 years for great businesses.
- **10-20% YoY**: solid. Most quality names.
- **5-10% YoY**: mature. Look for margin expansion to drive earnings.
- **0-5% YoY**: stagnant. Needs a catalyst.
- **Negative**: contracting. Often a structural problem.

### Earnings growth (YoY and QoQ)

How fast bottom-line profit is expanding.

- **EPS growing faster than revenue** = margin expansion. Good.
- **Revenue growing faster than EPS** = margin compression. Investigate (rising costs? competition?).
- **QoQ deceleration** = the leading edge of trouble. A stock at 30% revenue growth that drops to 25% next quarter, 20% the quarter after, is decelerating — markets punish this **before** absolute numbers turn bad.

### The "rule of 40" (for tech / SaaS)

`Revenue growth % + Operating margin % ≥ 40` is the threshold for a healthy software business. A company growing 20% with 20% operating margin = 40 (passes). 30% growth + 5% margin = 35 (fails).

### Watch for: organic vs. acquired growth

If a company is buying revenue via M&A, "growth" is misleading. Look at **organic revenue growth** (excluding acquisitions). Annual reports break this out; yfinance doesn't.

---

## 3. Profitability — "does growth become cash?"

Revenue is vanity, profit is sanity, cash is reality. (Old finance saying — still true.)

### Profit margin (net income ÷ revenue)

What percentage of every dollar of revenue becomes profit after everything (taxes, interest, COGS, opex).

| Sector | Typical net margin |
|---|---|
| Grocery / retail | 1-4% |
| Manufacturing | 5-10% |
| Industrials | 8-15% |
| Banks | 20-30% |
| Software | 20-40% |
| Luxury / brands | 15-25% |

A grocery chain at 5% margin is doing well. A software company at 5% margin is broken.

### Operating margin (operating income ÷ revenue)

Profit margin **before** interest and taxes. Cleaner read on operational efficiency. Compare across companies because tax rates and capital structure vary.

### Gross margin (gross profit ÷ revenue)

Revenue minus cost of goods sold (COGS). The widest margin number. Tells you how much of each dollar of revenue is left after producing the thing.

- **> 70%**: software, luxury brands.
- **40-60%**: most healthy businesses.
- **< 25%**: commodity / low-differentiation business.

**Trend matters more than level.** Rising gross margin = pricing power. Falling = competitive pressure or input cost inflation.

### Return on Equity (ROE)

Net income ÷ shareholders' equity. How much profit management generates per dollar of equity.

- **> 20%**: excellent.
- **10-20%**: solid.
- **< 10%**: capital-inefficient.

**Caveat:** high ROE can come from high leverage (debt). Always cross-check with debt-to-equity. ROE of 30% with D/E of 3.0 is not the same as ROE of 30% with D/E of 0.3.

### Return on Invested Capital (ROIC)

Net operating profit after tax ÷ (debt + equity). The cleanest profitability metric — what does the business earn per dollar of total capital, regardless of how it was financed.

- **ROIC > cost of capital** (~10% default proxy) = the business creates value.
- **ROIC < cost of capital** = the business destroys value (every new dollar invested earns less than it costs to raise).

Not in yfinance directly — needs calculation from the balance sheet.

---

## 4. Balance sheet — "can it survive a downturn?"

Profit means nothing if you go bankrupt before realizing it.

### Debt-to-Equity (D/E)

Total debt ÷ shareholders' equity.

- **< 0.5**: conservative.
- **0.5-1.5**: typical.
- **1.5-3.0**: leveraged. Acceptable for stable cash-flow businesses (utilities, REITs).
- **> 3.0**: highly leveraged. Risky in rate hikes or recessions.

**yfinance returns this two ways:** sometimes as a ratio (1.5), sometimes as a percent (150). Treat >150 (or >1.5 in ratio form) as the leverage threshold.

### Current ratio (current assets ÷ current liabilities)

Short-term liquidity. Can it pay bills due in the next 12 months?

- **> 1.5**: healthy.
- **1.0-1.5**: tight but functional.
- **< 1.0**: short-term liquidity problem (or capital-light business model).

### Free Cash Flow (FCF)

Operating cash flow minus capital expenditures. The number that actually matters — net income can be massaged, FCF mostly can't.

- **Positive and growing**: healthy.
- **Positive but flat / declining**: investigate.
- **Negative**: burning cash. Acceptable for early-stage growth companies (Amazon for years), red flag for mature companies.

**FCF yield** = FCF ÷ market cap. >5% is attractive; >8% is cheap (assuming the business isn't melting).

### Cash position vs. debt

A company with $50B cash and $20B debt is in a different universe than one with $50B debt and $5B cash. Look at **net debt** (debt - cash). Negative net debt (more cash than debt) is a fortress balance sheet — Apple, Google, Meta sit here.

---

## 5. Capital allocation — "what does management do with profits?"

Once a company makes money, four things can happen with it:

1. **Reinvest in the business** (R&D, capex, hiring). Drives future growth.
2. **Acquire other companies**. Mixed track record — most M&A destroys value.
3. **Buy back shares**. Reduces share count, increases EPS.
4. **Pay dividends**. Returns cash directly.

The right mix depends on stage:

- **Early growth**: 100% reinvest. No buybacks, no dividends.
- **Mature growth**: split between reinvestment and buybacks.
- **Mature, slow-growth**: buybacks + dividends dominate.

### Dividends

For income-oriented stocks (utilities, banks, consumer staples).

- **Dividend yield** = annual dividend ÷ share price. >3% is meaningful income.
- **Payout ratio** = dividend ÷ earnings. Should be < 60% for safety. > 80% means the dividend is at risk if earnings dip.
- **Dividend growth rate**: a 2% yield growing 10%/yr beats a 5% yield growing 0%.

### Buybacks

When done at low valuations: huge value creation. When done at high valuations: management overpaying with shareholder cash.

A high-quality buyback program reduces share count consistently for years. Look at "shares outstanding" trend in annual reports.

---

## 6. Quality / moat — "does the advantage persist?"

The hardest bucket to quantify. The "why does this company stay good?" question. Sources of durable advantage (Buffett's "moat"):

| Moat type | Example |
|---|---|
| **Network effects** | Visa, Mastercard, Meta — more users make it more valuable |
| **Switching costs** | Microsoft, Salesforce, SAP — too painful to leave |
| **Cost advantage** | Costco, Walmart — scale enables lower prices |
| **Intangibles / brand** | Apple, LVMH, Coke — pricing power from perception |
| **Efficient scale** | Utilities, railroads — natural monopoly in a region |

### Quantitative proxies for moat

- **High and stable gross margins** for years (vs. declining margins = competition)
- **ROIC consistently > 15%** for a decade (vs. boom-and-bust ROIC = no moat)
- **Pricing power** = revenue growth > unit growth (raising prices without losing customers)

A company with no moat will see margins compressed by competition over time. The numerical signs show up before the narrative does.

---

## 7. Calendar / catalysts — "what might move the price soon?"

### Next earnings date

The single biggest scheduled catalyst. The dashboard surfaces this from yfinance.

**For options:** IV inflates leading up to earnings, crushes after. Avoid:
- **Buying** options into earnings — IV crush eats you even if direction is right.
- **Cash-secured puts** with earnings inside the DTE window — assignment risk on a binary event.

**For stock:** earnings can move ±10% in a day. If you don't want that exposure, wait until after.

### Dividend ex-date

For income stocks. To collect the next dividend, you must hold the stock by market close on the day before ex-date.

### Product launches, FDA decisions, regulatory rulings

Outside fundamental data — track via news flow. Sector-specific (biotech FDA, fintech rate decisions, retail holiday quarters).

---

## How metrics interact (the actual decisions)

Single metrics in isolation lie. The skill is reading them together.

### "Cheap" valuation + decelerating growth = value trap

A stock at P/E 8 looks cheap until you notice revenue growth went from +15% to +5% to flat over three years. The market is pricing the deceleration, not being irrational. Examples: late-cycle Intel, Macy's, GameStop pre-meme.

**Test:** is the low P/E paired with stable or growing revenue? If yes → real value. If no → trap.

### High valuation + accelerating growth = momentum

P/E 60 looks expensive until you notice revenue growth went from 15% to 30% to 45%. The market is pricing the acceleration. Examples: Nvidia 2023-2025, Tesla 2020.

**Test:** is the growth rate **increasing**? Decelerating high-growth names compress brutally (P/E 50 → P/E 20 fast).

### High margins + low ROE = leverage problem

If profit margin is 25% but ROE is 15%, the business is profitable but capital-inefficient. Or it's diluting shareholders. Investigate.

### Negative FCF for years + growing revenue = bet on the future

Amazon ran negative FCF for years while reinvesting. So did Tesla, Uber, Netflix. **Sometimes** these are massive winners. **Often** they're cash incinerators that never reach the promised land.

**Test:** is the revenue growth fast enough to justify it? Is gross margin stable or improving? If the unit economics work and the company is just reinvesting aggressively, fine. If gross margins are negative, run.

### The DuPont decomposition

ROE = Net margin × Asset turnover × Leverage

This breaks down what's *driving* a high ROE. A bank with ROE 15% from 4× leverage is fragile. A software company with ROE 30% from 30% margins is durable. Same headline number, opposite quality.

---

## Red flags (skip the ticker)

If you see these, the company has structural problems — no valuation discount makes them worth owning.

- **Revenue growth negative for 3+ consecutive years** — secular decline.
- **Gross margins declining for 3+ consecutive years** — competitive moat gone.
- **Operating cash flow negative** while net income is positive — earnings quality problem (revenue recognized but not collected).
- **Debt-to-equity rising every year** while revenue is flat — borrowing to keep the lights on.
- **Frequent equity issuance** (rising share count) — diluting shareholders to fund operations.
- **Auditor changes / restatements** — accounting irregularities. Existential risk.
- **Insider selling** at scale (heldPercentInsiders dropping fast) — those who know best are leaving.
- **Goodwill > tangible book value** with multiple write-downs — overpaid for acquisitions.

---

## Sector context — same metrics, different thresholds

A "good" P/E or margin depends entirely on the sector. Some quick benchmarks:

### Tech / Software
- P/E 25-50 normal; 50-100 acceptable for high growth.
- Gross margin 70%+, operating margin 20%+ at scale.
- Revenue growth >15% expected.
- Often negative FCF early; should turn positive within 3-5 years.

### Banks / Financials
- P/E 8-12 normal.
- ROE 10-15% target.
- Tangible book value matters more than earnings.
- Watch loan loss provisions — rising = recession signal.

### Consumer staples (P&G, Coca-Cola)
- P/E 20-25 normal (pay for stability).
- Low growth (3-6% revenue), high margins (15-25%).
- Dividend yield 2-4%.

### Energy / Materials
- Cyclical — P/E swings wildly with commodity prices.
- Use **P/E on normalized earnings** (10-year average), not trailing.
- Free cash flow at mid-cycle is the right metric.

### Industrials (Caterpillar, GE)
- P/E 15-25 normal.
- Cyclical — same caveats as energy.
- Watch order backlog (forward demand indicator).

### Biotech (pre-revenue)
- P/E meaningless — no earnings.
- Focus on cash runway (FCF + cash position vs. burn rate).
- Pipeline catalysts (FDA dates) are everything.

### REITs (real estate)
- Use **FFO** (funds from operations), not P/E.
- Dividend yield 4-7% expected.
- Debt-to-equity high by design (1.5-3.0 normal).

---

## How this maps to the dashboard

The [Fundamentals panel](../src/lib/gemini/panels/fundamentals.ts) pulls all of this from yfinance and groups it into 6 bullet categories you'll see in the UI:

| Bullet prefix | What's covered | Buckets above |
|---|---|---|
| `[Valuation]` | P/E, fwd P/E, PEG, P/B, P/S | Bucket 1 |
| `[Growth]` | Revenue YoY, EPS YoY/QoQ | Bucket 2 |
| `[Profitability]` | Profit margin, operating margin, ROE | Bucket 3 |
| `[Balance sheet]` | D/E, FCF, cash, current ratio | Bucket 4 |
| `[Analyst view]` | Price target consensus, recommendation | Cross-cutting |
| `[Calendar]` | Next earnings date, DTE | Bucket 7 |

**Buckets 5 and 6 (capital allocation, moat) require deeper reads** — the panel can't infer "is the buyback program healthy" from a single yfinance snapshot. Pull the company's annual report (`10-K` for US names) for those.

The synth uses the panel as the **quality filter**: a stock that screens bullish on technicals + flow but is fundamentally broken (negative FCF, decelerating growth, D/E > 3) gets a conviction haircut. See [synth.ts](../src/lib/gemini/synth.ts) for the exact rules.

---

## A practical buying checklist

Before you click Buy on a stock, run through these. If 3+ are "no," skip it.

- [ ] Revenue growth positive over the last 3 years.
- [ ] Operating margin positive (or improving toward positive on a clear path).
- [ ] FCF positive (or burning cash for a clear, time-bound reinvestment reason).
- [ ] Debt-to-equity reasonable for the sector (< 1.5x for non-financial, < 3x for asset-heavy).
- [ ] Forward P/E reasonable vs. growth (PEG < 2 for growth names; P/E < 20 for slow growers).
- [ ] No earnings date inside the next ~10 days (unless that's specifically the bet).
- [ ] You'd be comfortable holding for 3+ years if the price drops 20% short-term.
- [ ] You can articulate the moat in one sentence — why does the business stay good?

The last two are the hardest. They're also the ones that matter most over a decade.

---

## Further reading

- **The Intelligent Investor** — Benjamin Graham. The original value-investing framework. Chapters 8 and 20 are the essential ones.
- **Common Stocks and Uncommon Profits** — Philip Fisher. The growth-investing complement to Graham.
- **One Up On Wall Street** — Peter Lynch. Practical, retail-friendly, still excellent.
- **The Little Book That Beats the Market** — Joel Greenblatt. The "magic formula" — combines low P/E and high ROIC into a screen.
- **Berkshire Hathaway annual letters** (1965-present, free at berkshirehathaway.com). Buffett explaining his thinking on every metric here, with examples.

For sector-specific analysis (banks, REITs, biotech), each has its own playbook — the metrics in this doc are the universal ones.
