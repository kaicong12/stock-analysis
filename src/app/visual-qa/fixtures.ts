import type { DashboardData, PanelSummary, TechnicalIndicators, Verdict } from "../../lib/types";
import type { WheelPlan } from "../../lib/wheel/types";

export const technicalIndicators = {
  symbol: "US.GOOGL",
  spot: 187.42,
  asOf: "2026-08-07",
  barsUsed: 260,
  rsi14: 58.2,
  rsiState: "neutral",
  macd: 1.84,
  macdSignal: 1.42,
  macdHist: 0.42,
  bbUpper: 194.1,
  bbMid: 182.6,
  bbLower: 171.1,
  bbPctB: 0.71,
  sma20: 182.6,
  sma50: 176.3,
  sma200: 164.85,
  pctVsSma20: 2.64,
  pctVsSma50: 6.31,
  pctVsSma200: 13.69,
  high52w: 208.7,
  low52w: 131.55,
  pctOff52wHigh: -10.19,
  ret5d: 2.31,
  ret20d: 6.44,
  adx14: 24.6,
  plusDi: 27.1,
  minusDi: 15.4,
  regime: "uptrend",
  rsiDivergence: "none",
  support: 178.4,
  resistance: 196.2,
  supportLevels: [178.4, 171.05, 164.8],
  resistanceLevels: [196.2, 203.5, 208.7],
  structureBias: "up",
  structureEvent: "BOS",
  structureDirection: "up",
  structureLevel: 184.9,
} satisfies TechnicalIndicators;

const panel = (p: PanelSummary): PanelSummary => p;

export const panels: Verdict["panels"] = {
  fundamentals: panel({
    headline: "**Wide-moat compounder** trading at 21× forward with accelerating cloud margins.",
    direction: "bullish",
    conclusion: "Balance sheet is pristine; the multiple is undemanding versus the growth being delivered.",
    bullets: [
      "Revenue +14% YoY, cloud segment +28% with first full year of positive operating margin.",
      "Net cash position of ~$95B against negligible debt — `debtToEquity` under 10%.",
      "Free cash flow conversion above 22% of revenue, funding buybacks without leverage.",
    ],
    meta: [
      { label: "Fwd P/E", value: "21.4" },
      { label: "PEG", value: "1.28" },
      { label: "ROE", value: "31.2%" },
      { label: "Net cash", value: "$95B" },
    ],
  }),
  capital: panel({
    headline: "Institutional block prints skew to the **bid** for a fourth straight session.",
    direction: "bullish",
    conclusion: "Large-lot accumulation without a matching retail bid — typically a constructive tell.",
    bullets: [
      "Net large-order inflow of $412M over five sessions.",
      "Broker concentration rising: top-3 net buyers account for 38% of volume.",
      "Short interest flat at 0.9% of float — no squeeze dynamic in play.",
    ],
    meta: [
      { label: "Net flow", value: "+$412M" },
      { label: "Large %", value: "38%" },
    ],
  }),
  technical: panel({
    headline: "Break of structure to the upside, holding above a reclaimed 20-day.",
    direction: "bullish",
    conclusion: "Trend intact; nearest demand sits at 178.40 which frames the put strike.",
    bullets: [
      "ADX 24.6 with +DI > −DI — a genuine trend regime, not a range.",
      "RSI 58 leaves headroom before overbought.",
      "MACD histogram positive and expanding.",
    ],
    meta: [
      { label: "RSI(14)", value: "58.2" },
      { label: "ADX", value: "24.6" },
      { label: "Support", value: "178.40" },
    ],
  }),
  wheel: panel({
    headline: "Premium is *fair*, not rich — but the 175 put sits below both the band and support.",
    direction: "neutral",
    conclusion: "A reasonable price to be assigned at; the credit is adequate pay for waiting.",
    bullets: [
      "ATM IV 24.1% against HV30 of 21.8% — a modest 1.11× premium.",
      "Realized-vol percentile at the 46th (a proxy for IV Rank, not IV Rank).",
      "Every listed strike clears the 1-SD expected move on both legs.",
    ],
    meta: [
      { label: "ATM IV", value: "24.1%" },
      { label: "IV/HV", value: "1.11×" },
      { label: "HV pct", value: "46th" },
    ],
  }),
  sentiment: panel({
    headline: "Community tone constructive but thin — 62% bullish across 340 posts.",
    direction: "neutral",
    conclusion: "No crowding signal in either direction.",
    bullets: [
      "Discussion volume is below its 30-day average.",
      "Bear case centres on regulatory headlines rather than fundamentals.",
    ],
    meta: [{ label: "Bull %", value: "62%" }, { label: "Posts", value: "340" }],
  }),
  digest: panel({
    headline: "Stock digest",
    direction: "bullish",
    bullets: [],
    prose: `**Short-term direction: constructive.**

Three items dominate the last fortnight:

1. **Cloud backlog** — management disclosed a record remaining performance obligation, up 46% YoY. This is the single most durable datapoint in the print.
2. **Regulatory** — the EU remedy proposal landed softer than feared; the market read it as removing a tail risk rather than adding one.
3. **Capex** — guided higher again. Bears frame this as margin pressure; the offset is that it is demand-driven, not speculative.

| Item | Read | Weight |
| --- | --- | --- |
| Cloud RPO | Bullish | High |
| EU remedy | Bullish | Medium |
| Capex guide | Mixed | Medium |

> Nothing in the window constitutes a binary event before the next print.

Net: the tape and the news flow agree for once.`,
    evidence: [
      { title: "Cloud backlog hits record as enterprise deals lengthen", url: "https://example.com/a" },
      { title: "EU accepts narrower remedy package", url: "https://example.com/b" },
    ],
  }),
  news: panel({
    headline: "Flow is **net positive**, with the regulatory overhang easing.",
    direction: "bullish",
    conclusion: "No headline in the window would change an entry decision.",
    bullets: [
      "Two upgrades on the cloud margin trajectory.",
      "No litigation or agency action dated inside the expiry window.",
    ],
    evidence: [
      { title: "Analyst lifts target on cloud margin inflection", url: "https://example.com/1" },
      { title: "Regulator signals narrower remedy scope", url: "https://example.com/2" },
      { title: "Datacenter capex guide raised for a third quarter", url: "https://example.com/3" },
    ],
    readThrough: [
      {
        peer: "MSFT",
        classification: "sector-sentiment",
        direction: "bullish",
        note: "Azure reacceleration read across to hyperscaler demand broadly.",
        url: "https://example.com/msft",
      },
      {
        peer: "META",
        classification: "shared-input",
        direction: "neutral",
        note: "Higher accelerator pricing is a shared cost input; margin impact symmetrical.",
        url: "https://example.com/meta",
      },
      {
        peer: "AMZN",
        classification: "competitive",
        direction: "bearish",
        note: "Aggressive AWS discounting could compress cloud pricing at the margin.",
        url: "https://example.com/amzn",
      },
    ],
  }),
  insider: panel({
    headline: "Selling is overwhelmingly **routine** — no discretionary conviction either way.",
    direction: "neutral",
    conclusion: "Plan sales dominate; the signal here is close to zero.",
    bullets: [
      "No open-market purchases in the trailing 90 days.",
      "94% of disposed value came through pre-scheduled 10b5-1 plans.",
    ],
    insiderFlow: [
      {
        name: "R. Porat", title: "President & CIO", typeLabel: "Sell (10b5-1)", direction: "neutral",
        routine: true, date: "2026-07-28", shares: 12500, value: 2340000, pctOfHoldings: 0.021,
      },
      {
        name: "S. Pichai", title: "CEO", typeLabel: "Sell (10b5-1)", direction: "neutral",
        routine: true, date: "2026-07-22", shares: 33000, value: 6180000, pctOfHoldings: 0.014,
      },
      {
        name: "K. Walker", title: "Chief Legal Officer", typeLabel: "Sell (open mkt)", direction: "sell",
        routine: false, date: "2026-07-15", shares: 8200, value: 1520000, pctOfHoldings: 0.184,
      },
      {
        name: "J. Doerr", title: "Director", typeLabel: "Buy (open mkt)", direction: "buy",
        routine: false, date: "2026-06-30", shares: 4000, value: 728000, pctOfHoldings: null,
      },
      {
        name: "P. Venkatesan", title: "SVP Engineering", typeLabel: "Grant", direction: "neutral",
        routine: true, date: "2026-06-14", shares: 2100, value: 0, pctOfHoldings: null,
      },
    ],
  }),
};

export const verdict: Verdict = {
  rationale:
    "The tape, the flow and the fundamentals point the same way for once: a wide-moat compounder in a confirmed uptrend with institutional accumulation behind it. Premium is only *fair* — the realized-vol percentile sits mid-range — but that is a downgrade to the pay, not a reason to skip an entry at a price worth owning. The 175 put clears both the 1-SD expected move and the nearest swing support at 178.40, which is the placement that matters. Nothing binary lands inside the window.",
  riskFactor:
    "A renewed regulatory escalation would hit the multiple before it hits the earnings, and the 178.40 shelf is the only meaningful demand above 171.",
  stock: {
    action: "OPEN",
    direction: "bullish",
    confidence: 72,
    adjustment: {
      instruction:
        "Open a fresh long only if you are prepared to hold through a multiple de-rate; scale on weakness toward the 178 shelf rather than chasing the break.",
      entry: "178.40 – 184.00",
      target: "196.20",
      stop: "Below 171.05",
      timeframe: "6–12 months",
    },
  },
  derivatives: {
    action: "SELL_CASH_SECURED_PUT",
    direction: "bullish",
    confidence: 64,
    adjustment: {
      instruction:
        "**If you hold the cash to be assigned**, sell the 175 put in the 38-day expiry. Assignment at 175 is an outcome worth accepting, not a failure to manage around.",
      entry: "175 strike, 38 DTE",
      timeframe: "38 days to expiry",
      sizing: "Size at your broker",
    },
  },
  technicalIndicators,
  panels,
};

export const dashboard: DashboardData = {
  ticker: "GOOGL",
  symbol: "US.GOOGL",
  generatedAt: "2026-08-08T09:30:00.000Z",
  snapshot: {
    symbol: "US.GOOGL",
    name: "Alphabet Inc-CL A",
    lastPrice: 187.42,
    prevClose: 184.11,
    changePct: 1.798,
    volume: 21_400_000,
    updateTime: "2026-08-07 16:00:00",
    raw: {},
  },
  capital: null,
  technical: null,
  news: null,
  sentiment: null,
  fundamentals: null,
  verdict,
  errors: [
    { source: "insider", message: "Massive API returned 429 — retried once, still throttled." },
    { source: "sentiment", message: "moomoo feed returned an empty payload for US.GOOGL." },
  ],
};

const strike = (
  s: number,
  delta: number,
  bid: number,
  mid: number,
  annYield: number,
  zonePos: "good" | "fair" | "rich",
  clearsLevel: boolean,
) => ({
  strike: s, delta, bid, ask: mid + (mid - bid), mid,
  iv: 0.241, openInterest: 1840, volume: 96, spreadPct: 0.06,
  annYield, zonePos, clearsLevel,
});

export const wheelPlan: WheelPlan = {
  symbol: "US.GOOGL",
  ticker: "GOOGL",
  spot: 187.42,
  regime: {
    symbol: "US.GOOGL",
    hv30: 0.218, hv30Pct: 46, hv30Low: 0.152, hv30High: 0.394,
    atmIv: 0.241, expiryUsed: "2026-09-18", dte: 41, ivHv30: 1.11,
    chainError: null, label: "fair", sampleBars: 252,
  },
  zone: {
    low: 168.2, high: 181.5, partial: false,
    anchors: { analystTargetLow: 168.2, sma200: 164.85, support: 178.4 },
  },
  putLeg: [
    {
      expiry: "2026-09-18", dte: 41, atmIv: 0.241, emLower: 176.1, emUpper: 198.7,
      earningsInWindow: false, exDivInWindow: false, excluded: null,
      rows: [
        strike(175, -0.24, 3.1, 3.25, 16.5, "fair", true),
        strike(172.5, -0.2, 2.55, 2.68, 13.8, "fair", true),
        strike(170, -0.17, 2.05, 2.18, 11.4, "good", true),
        strike(165, -0.12, 1.32, 1.44, 7.8, "good", true),
      ],
    },
    {
      expiry: "2026-10-16", dte: 69, atmIv: 0.236, emLower: 169.4, emUpper: 205.4,
      earningsInWindow: false, exDivInWindow: true, excluded: null,
      rows: [
        strike(167.5, -0.21, 3.85, 4.05, 12.8, "good", true),
        strike(162.5, -0.16, 2.9, 3.1, 10.1, "good", true),
      ],
    },
    {
      expiry: "2026-11-20", dte: 104, atmIv: null, emLower: null, emUpper: null,
      earningsInWindow: true, exDivInWindow: false, excluded: "earnings inside the window",
      rows: [],
    },
  ],
  callLeg: [
    {
      expiry: "2026-09-18", dte: 41, atmIv: 0.241, emLower: 176.1, emUpper: 198.7,
      earningsInWindow: false, exDivInWindow: false, excluded: null,
      rows: [
        strike(200, 0.22, 2.75, 2.9, 15.1, "fair", true),
        strike(205, 0.16, 1.85, 1.98, 10.3, "good", true),
        strike(210, 0.11, 1.15, 1.28, 6.7, "good", true),
      ],
    },
    {
      expiry: "2026-10-16", dte: 69, atmIv: 0.236, emLower: 169.4, emUpper: 205.4,
      earningsInWindow: false, exDivInWindow: false, excluded: null,
      rows: [],
    },
  ],
  warning:
    "Mild breakdown flagged by the price-action guard — price is 2.1% off the 20-day high on expanding volume. Weigh it; it does not block the entry.",
  blocked: false,
};

export const macroText = `## Rates & liquidity

**Risk tone: constructive, narrowing.**

- Front-end rates drifted 6bp lower on a softer services print; the market now prices two cuts before year-end.
- Breadth remains poor — the equal-weight index lags the cap-weighted by 380bp QTD.
- Credit spreads are unchanged, which argues the equity bid is positioning rather than stress.

*No FOMC, CPI or payroll print lands inside the next 45 days.*`;
