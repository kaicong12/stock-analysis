"use client";

import { useState } from "react";
import styles from "../page.module.css";
import type {
  ContractLeg,
  ContractPick,
  DashboardData,
  DerivativesAction,
  PositionAdjustment,
  SleeveDirection,
  SleeveVerdict,
  StockAction,
  Verdict,
} from "../../lib/types";
import {
  IconArrowDown,
  IconArrowUp,
  IconCloseX,
  IconHold,
  IconPlay,
  IconRoll,
  IconSparkle,
} from "./icons";
import { OrderModal, type OrderModalIntent } from "./OrderModal";

type Tone = "bullish" | "bearish" | "neutral";
type IconCmp = (props: { className?: string }) => React.ReactElement;

// Buckets mirror synth.ts: 50 = coin-flip, >75 = strong, 90+ = rare.
function confidenceInterpretation(c: number): string {
  if (c >= 90) return "Rare — overwhelming alignment, used sparingly";
  if (c >= 75) return "Strong conviction — clear thesis with corroboration";
  if (c >= 65) return "Decent conviction — multiple panels aligned";
  if (c >= 55) return "Weak lean — directional signal present but not strong";
  return "Coin-flip — panels disagree, no edge";
}

const STOCK_ACTION_META: Record<StockAction, { label: string; baseIcon: IconCmp }> = {
  OPEN: { label: "Open Position", baseIcon: IconArrowUp },
  INCREASE: { label: "Increase", baseIcon: IconArrowUp },
  TRIM: { label: "Trim", baseIcon: IconArrowDown },
  HOLD: { label: "Hold", baseIcon: IconHold },
  CLOSE: { label: "Close", baseIcon: IconCloseX },
  PASS: { label: "Pass", baseIcon: IconHold },
};

const DERIVATIVES_ACTION_META: Record<DerivativesAction, { label: string; baseIcon: IconCmp; defaultTone: Tone }> = {
  SELL_PUT_SPREAD: { label: "Sell Put Spread", baseIcon: IconArrowUp, defaultTone: "bullish" },
  SELL_CALL_SPREAD: { label: "Sell Call Spread", baseIcon: IconArrowDown, defaultTone: "bearish" },
  SELL_COVERED_CALL: { label: "Sell Covered Call", baseIcon: IconHold, defaultTone: "neutral" },
  SELL_CASH_SECURED_PUT: { label: "Sell Cash-Secured Put", baseIcon: IconHold, defaultTone: "neutral" },
  IRON_CONDOR: { label: "Iron Condor", baseIcon: IconHold, defaultTone: "neutral" },
  ROLL_OUT: { label: "Roll Out", baseIcon: IconRoll, defaultTone: "neutral" },
  INCREASE: { label: "Increase", baseIcon: IconArrowUp, defaultTone: "bullish" },
  TRIM: { label: "Trim", baseIcon: IconArrowDown, defaultTone: "bearish" },
  HOLD: { label: "Hold", baseIcon: IconHold, defaultTone: "neutral" },
  CLOSE: { label: "Close", baseIcon: IconCloseX, defaultTone: "bearish" },
  PASS: { label: "Pass", baseIcon: IconHold, defaultTone: "neutral" },
};

const DIRECTION_TONE: Record<SleeveDirection, Tone> = {
  bullish: "bullish",
  bearish: "bearish",
  neutral: "neutral",
};

function toneCls(tone: Tone): string {
  return tone === "bullish" ? styles.actionBullish : tone === "bearish" ? styles.actionBearish : styles.actionNeutral;
}

// Mon–Fri 9:30 AM – 4:00 PM America/New_York. DST-aware via Intl. Doesn't
// account for US market holidays — close enough for the user-facing hint
// distinguishing "RTH open but snapshot incomplete" from "market closed".
function isUsRthNow(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = hh * 60 + mm;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function VerdictCard({ data, isPickLoading = false, pickError = null }: { data: DashboardData; isPickLoading?: boolean; pickError?: string | null }) {
  const v = data.verdict!;
  const generated = new Date(data.generatedAt);
  const generatedStr = new Intl.DateTimeFormat("en-SG", { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(generated);

  return (
    <section className={styles.verdictCard}>
      <div className={styles.verdictCardHeader}>
        <div className={styles.verdictTitle + " font-display"}>
          <IconSparkle />
          Alpha Insight Synthesis
        </div>
        <div className={styles.verdictMeta}>Generated {generatedStr}</div>
      </div>

      <div className={styles.confidenceBlock}>
        <div className={styles.confidenceLabel}>Stock</div>
        <div className={styles.confidenceValue + " font-display"}>{v.stock.confidence}%</div>
        <div className={styles.confidenceInterpretation}>{confidenceInterpretation(v.stock.confidence)}</div>
        <div className={styles.confidenceTrack}><div className={styles.confidenceFill} style={{ width: `${Math.max(2, Math.min(100, v.stock.confidence))}%` }} /></div>
        <div className={styles.confidenceLabel} style={{ marginTop: 12 }}>Derivatives</div>
        <div className={styles.confidenceValue + " font-display"}>{v.derivatives.confidence}%</div>
        <div className={styles.confidenceInterpretation}>{confidenceInterpretation(v.derivatives.confidence)}</div>
        <div className={styles.confidenceTrack}><div className={styles.confidenceFill} style={{ width: `${Math.max(2, Math.min(100, v.derivatives.confidence))}%` }} /></div>
      </div>

      <div className={styles.sleeveGrid}>
        <StockSleeve sleeve={v.stock} />
        <DerivativesSleeve
          sleeve={v.derivatives}
          isPickLoading={isPickLoading}
          pickError={pickError}
          verdict={v}
          ticker={data.ticker}
          // IBKR underlying lookups expect the bare ticker (e.g. "NVDA"),
          // not the moomoo-prefixed symbol ("US.NVDA"). data.ticker is bare;
          // data.symbol is the moomoo form used for snapshot/news APIs only.
          symbol={data.ticker}
        />
      </div>

      <p className={styles.rationale}>{v.rationale}</p>
      <div className={styles.riskRow}>
        <strong>Risk</strong>
        <span>{v.riskFactor}</span>
      </div>
    </section>
  );
}

function StockSleeve({ sleeve }: { sleeve: SleeveVerdict<StockAction> }) {
  const meta = STOCK_ACTION_META[sleeve.action];
  // OPEN/INCREASE/HOLD/PASS take their tone from direction; TRIM/CLOSE are always bearish-flavored exits.
  const tone: Tone = sleeve.action === "TRIM" || sleeve.action === "CLOSE"
    ? "bearish"
    : DIRECTION_TONE[sleeve.direction];
  const Icon = meta.baseIcon;
  return (
    <div className={styles.sleeve}>
      <div className={styles.sleeveLabel}>Stock Sleeve</div>
      <div className={styles.actionRow}>
        <span className={styles.actionLabel}>Action</span>
        <span className={styles.actionTitle + " " + toneCls(tone)}>
          <Icon className={styles.actionIcon} />
          {meta.label}
        </span>
      </div>
      <AdjustmentBlock adj={sleeve.adjustment} />
    </div>
  );
}

function DerivativesSleeve({
  sleeve,
  isPickLoading,
  pickError,
  verdict,
  ticker,
  symbol,
}: {
  sleeve: SleeveVerdict<DerivativesAction>;
  isPickLoading: boolean;
  pickError: string | null;
  verdict: Verdict;
  ticker: string;
  symbol: string;
}) {
  const meta = DERIVATIVES_ACTION_META[sleeve.action];
  const tone: Tone = (sleeve.action === "INCREASE" || sleeve.action === "HOLD" || sleeve.action === "PASS")
    ? DIRECTION_TONE[sleeve.direction]
    : meta.defaultTone;
  const Icon = meta.baseIcon;
  return (
    <div className={styles.sleeve}>
      <div className={styles.sleeveLabel}>Derivatives Sleeve</div>
      <div className={styles.actionRow}>
        <span className={styles.actionLabel}>Action</span>
        <span className={styles.actionTitle + " " + toneCls(tone)}>
          <Icon className={styles.actionIcon} />
          {meta.label}
        </span>
      </div>
      <AdjustmentBlock adj={sleeve.adjustment} />
      {sleeve.contractPick
        ? <ContractPickCard pick={sleeve.contractPick} verdict={verdict} ticker={ticker} symbol={symbol} />
        : isPickLoading
          ? <ContractPickSkeleton />
          : pickError
            ? <ContractPickError message={pickError} />
            : null}
    </div>
  );
}

function friendlyPickHint(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("no bridge")) {
    return "IBKR trading session not bridged — the Client Portal Gateway dropped its iserver session. Open the gateway in a browser tab (typically https://localhost:5000 or :5001 — whichever your IBKR_BASE_URL points to) and re-authenticate, then re-search.";
  }
  if (m.includes("competing")) {
    return "Another IBKR session is active (e.g., the web TWS in another tab). Close it or reauthenticate, then re-search.";
  }
  if (m.includes("rate limit") || m.includes("429") || m.includes("too many")) {
    return "Hit a model rate limit. Wait a few seconds and re-search; consider switching off the :free OpenRouter tier if this happens often.";
  }
  if (m.includes("timeout") || m.includes("aborted")) {
    return "Picker timed out. The model or IBKR snapshot took too long; re-search to retry.";
  }
  if (m.includes("invalid spot")) {
    return "Couldn't read a valid spot price for the underlying — chain fetch aborted before the picker ran.";
  }
  if (m.includes("no option chain") || m.includes("no expiries")) {
    return "No option chain available for this symbol. IBKR returned no expiries in the 20–60 DTE window — common when the ticker collides with a non-equity instrument (index/CFD) or the underlying has no listed options. Re-search to retry; if persistent, the symbol may need disambiguation.";
  }
  return "Contract picker failed. The verdict is unaffected; the strike-selection step couldn't complete. Details below.";
}

function ContractPickError({ message }: { message: string }) {
  return (
    <div className={styles.contractCard} aria-live="polite" style={{ borderColor: "var(--bearish)" }}>
      <div className={styles.contractStrategy}>
        <span className={styles.contractStrategyLabel} style={{ color: "var(--bearish)" }}>Contract picker failed</span>
      </div>
      <p className={styles.contractRationale} style={{ fontStyle: "normal" }}>{friendlyPickHint(message)}</p>
      <p className={styles.contractRationale} style={{ fontSize: 11, opacity: 0.6 }}>{message}</p>
    </div>
  );
}

function ContractPickSkeleton() {
  return (
    <div className={styles.contractCard} aria-busy="true" aria-live="polite">
      <div className={styles.contractStrategy}>
        <span className={styles.contractStrategyLabel}>Picking contract from chain…</span>
        <div className={styles.skeleton} style={{ height: 11, width: 200 }} />
      </div>
      <div className={styles.contractLegs}>
        <div className={styles.skeleton} style={{ height: 32 }} />
        <div className={styles.skeleton} style={{ height: 32 }} />
      </div>
      <div className={styles.contractMetrics}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.skeleton} style={{ height: 28, width: 78 }} />
        ))}
      </div>
      <div className={styles.skeleton} style={{ height: 11, width: "92%" }} />
      <div className={styles.skeleton} style={{ height: 11, width: "70%" }} />
    </div>
  );
}

function AdjustmentBlock({ adj }: { adj: PositionAdjustment }) {
  const chips: { label: string; value: string; tone?: "bullish" | "bearish" }[] = [];
  if (adj.sizing) chips.push({ label: "Size", value: adj.sizing });
  if (adj.entry) chips.push({ label: "Entry", value: adj.entry });
  if (adj.stop) chips.push({ label: "Stop", value: adj.stop, tone: "bearish" });
  if (adj.target) chips.push({ label: "Target", value: adj.target, tone: "bullish" });
  if (adj.timeframe) chips.push({ label: "Timeframe", value: adj.timeframe });
  return (
    <div className={styles.adjustmentBlock}>
      <div className={styles.adjustmentHeader}>
        <IconPlay /> What to do
      </div>
      <p className={styles.adjustmentInstruction}>{adj.instruction}</p>
      {chips.length > 0 && (
        <div className={styles.adjustmentChips}>
          {chips.map((c) => (
            <span
              key={c.label}
              className={
                styles.adjChip + (c.tone === "bullish" ? " " + styles.bullish : c.tone === "bearish" ? " " + styles.bearish : "")
              }
            >
              <span className={styles.adjChipLabel}>{c.label}</span>
              <span className={styles.adjChipValue}>{c.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Delta-as-POP approximation. This is the standard retail option-platform
// heuristic — short-leg |Δ| ≈ probability the contract finishes ITM at expiry,
// so 1 − |Δ| is the probability the contract is OTM (i.e. POP for a short).
// It's an approximation: real POP requires a vol-aware Monte Carlo or a
// risk-neutral pricing model. For long debit structures we fall back to the
// long-leg delta as a rough "chance of finishing ITM" proxy.
function popFromPick(pick: ContractPick): number | null {
  const absD = (d: number | null | undefined): number | null => d == null ? null : Math.abs(d);
  switch (pick.strategy) {
    case "SELL_PUT_SPREAD":
    case "SELL_CALL_SPREAD":
    case "SELL_CASH_SECURED_PUT":
    case "SELL_COVERED_CALL": {
      const dShort = absD(pick.shortLeg?.delta);
      return dShort == null ? null : 1 - dShort;
    }
    case "IRON_CONDOR": {
      const dp = absD(pick.shortPutLeg?.delta);
      const dc = absD(pick.shortCallLeg?.delta);
      if (dp == null || dc == null) return null;
      return Math.max(0, 1 - dp - dc);
    }
    default:
      return null;
  }
}

function popTone(pop: number | null): "bullish" | "bearish" | "neutral" {
  if (pop == null) return "neutral";
  if (pop >= 0.65) return "bullish";
  if (pop < 0.50) return "bearish";
  return "neutral";
}

function ContractPickCard({ pick, verdict, ticker, symbol }: { pick: ContractPick; verdict: Verdict; ticker: string; symbol: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  if (pick.strategy === "ROLL_OUT" && pick.rollPlan) {
    return <RollPickCard pick={pick} verdict={verdict} ticker={ticker} symbol={symbol} />;
  }
  const isSpread = !!pick.longLeg && !!pick.shortLeg;
  const isCredit = pick.netCredit !== undefined && pick.netCredit !== null;
  const quoted = pick.quotesAvailable;
  const dash = "—";
  const pop = popFromPick(pick);
  const popLabel = pop == null ? dash : `${Math.round(pop * 100)}%`;
  return (
    <div className={styles.contractCard}>
      <div className={styles.contractStrategy}>
        <span className={styles.contractStrategyLabel}>Suggested Contract</span>
        <span className={styles.contractIv}>{pick.ivPercentileNote}</span>
      </div>
      {!quoted && (
        <div className={styles.contractLegPlain} style={{ color: "var(--bearish)", fontStyle: "normal" }}>
          {isUsRthNow()
            ? "Live quotes unavailable for these strikes — IBKR snapshot returned without bid/ask/last. Re-search to retry; the strikes may also be illiquid."
            : "Live quotes unavailable for these strikes — economics will populate during US RTH (9:30 AM – 4:00 PM ET)."}
        </div>
      )}
      <EarningsBanner pick={pick} />
      <div className={styles.contractLegs}>
        {pick.longLeg && <ContractLegRow leg={pick.longLeg} side="BUY" />}
        {pick.shortLeg && <ContractLegRow leg={pick.shortLeg} side={isSpread ? "SELL" : "SELL"} />}
        {!pick.longLeg && !pick.shortLeg && (
          <div className={styles.contractLegPlain}>(legs not provided)</div>
        )}
      </div>
      <div className={styles.contractMetrics}>
        <Metric
          label={isCredit ? "Credit" : "Limit"}
          value={quoted ? `$${pick.limitPrice.toFixed(2)}` : dash}
          tone="neutral"
        />
        <Metric
          label="Max P"
          value={quoted ? `$${Math.round(pick.maxProfit).toLocaleString("en-US")}` : dash}
          tone="bullish"
        />
        <Metric
          label="Max L"
          value={quoted ? `$${Math.round(pick.maxLoss).toLocaleString("en-US")}` : dash}
          tone="bearish"
        />
        <Metric
          label="ROC"
          value={
            quoted && pick.maxLoss > 0
              ? `${((pick.maxProfit / pick.maxLoss) * 100).toFixed(1)}%`
              : dash
          }
          tone="neutral"
        />
        <Metric
          label="Breakeven"
          value={quoted ? `$${pick.breakeven.toFixed(2)}` : dash}
          tone="neutral"
        />
        <Metric
          label="POP"
          value={popLabel}
          tone={popTone(pop)}
        />
        <Metric label="Contracts" value={String(pick.suggestedContracts)} tone="neutral" />
        <Metric
          label="Max Risk"
          value={quoted ? `$${Math.round(pick.capitalRequired).toLocaleString("en-US")}` : dash}
          tone="neutral"
        />
      </div>
      {quoted && (
        <div className={styles.journalActions} style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setModalOpen(true)}
            disabled={pick.earningsInWindow === true}
            title={
              pick.earningsInWindow === true
                ? "Chosen expiry straddles an earnings print — disabled for conservative profile."
                : undefined
            }
            style={pick.earningsInWindow === true ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          >
            Log to journal
          </button>
        </div>
      )}
      {modalOpen && (
        <OrderModal
          intent={{ kind: "open-pick", pick, verdict, ticker, symbol } as OrderModalIntent}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

function RollPickCard({ pick, verdict, ticker, symbol }: { pick: ContractPick; verdict: Verdict; ticker: string; symbol: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  const rp = pick.rollPlan!;
  const isCredit = rp.netRollCredit >= 0;
  return (
    <div className={styles.contractCard}>
      <div className={styles.contractStrategy}>
        <span className={styles.contractStrategyLabel}>Suggested Roll</span>
        <span className={styles.contractIv}>{pick.ivPercentileNote}</span>
      </div>
      <div className={styles.rollSection}>
        <div className={styles.rollSectionLabel}>Close (existing)</div>
        <div className={styles.contractLegs}>
          {rp.closingLegs.length === 0 && (
            <div className={styles.contractLegPlain}>(no held legs)</div>
          )}
          {rp.closingLegs.map((leg, i) => (
            <ContractLegRow key={`c-${i}`} leg={leg} side="CLOSE" />
          ))}
        </div>
      </div>
      <div className={styles.rollSection}>
        <div className={styles.rollSectionLabel}>Open (replacement)</div>
        <div className={styles.contractLegs}>
          {rp.openingLegs.map((leg, i) => (
            <ContractLegRow key={`o-${i}`} leg={leg} side="OPEN" />
          ))}
        </div>
      </div>
      <EarningsBanner pick={pick} />
      <div className={styles.contractMetrics}>
        <Metric
          label="Net Credit"
          value={`${isCredit ? "+" : ""}$${Math.round(rp.netRollCredit).toLocaleString("en-US")}`}
          tone={isCredit ? "bullish" : "bearish"}
        />
        <Metric label="Open Credit" value={`$${Math.round(rp.openingCredit).toLocaleString("en-US")}`} tone="neutral" />
        <Metric label="Close Cost" value={`$${Math.round(rp.closingCost).toLocaleString("en-US")}`} tone="neutral" />
        <Metric label="New Max P" value={`$${Math.round(rp.newMaxProfit).toLocaleString("en-US")}`} tone="bullish" />
        <Metric label="New Max L" value={`$${Math.round(rp.newMaxLoss).toLocaleString("en-US")}`} tone="bearish" />
        <Metric label="New BE" value={`$${rp.newBreakeven.toFixed(2)}`} tone="neutral" />
        <Metric label="Contracts" value={String(pick.suggestedContracts)} tone="neutral" />
      </div>
      <div className={styles.journalActions} style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => setModalOpen(true)}
        >
          Log roll to journal
        </button>
      </div>
      {modalOpen && (
        <OrderModal
          intent={{ kind: "roll", pick, verdict, ticker, symbol } as OrderModalIntent}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

// Per-leg quote shown next to each leg row. The spread economics elsewhere on
// the card use the executable mid = (bid + ask) / 2, falling back to bid, ask,
// then last. Showing `last` here is misleading on OTM strikes where last is
// often hours stale while bid/ask are live — the user can't reconcile
// "shortLast − longLast" against the credit. Match the picker's pricing
// convention so the math adds up visibly.
// Banner that always renders the earnings-vs-trade-window status on a pick.
// Conservative trader requirement: be FULLY OUT ≥ 2 days before earnings.
// - No earnings in fundamentals → neutral chip ("No earnings in fundamentals").
// - Earnings set + chosen expiry preEarningsSafe → green chip showing date,
//   days away, and that the expiry finishes before the print.
// - Earnings set + chosen expiry STRADDLES the print → red chip; Place Order
//   button is also disabled upstream.
function EarningsBanner({ pick }: { pick: ContractPick }) {
  const date = pick.nextEarningsDate ?? null;
  const days = pick.earningsDaysAway ?? null;
  // No earnings data — neutral one-liner so the user always sees a status.
  if (date == null) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "var(--on-surface-variant)",
          marginTop: 2,
          paddingLeft: 2,
        }}
      >
        Earnings: not in fundamentals — no earnings constraint applies.
      </div>
    );
  }
  // Pull the chosen expiry off whichever leg the picker populated.
  const expiry =
    pick.shortLeg?.expiry ??
    pick.longLeg?.expiry ??
    pick.shortPutLeg?.expiry ??
    pick.longPutLeg?.expiry ??
    pick.rollPlan?.openingLegs?.[0]?.expiry ??
    null;
  const inWindow = pick.earningsInWindow === true;
  const bg = inWindow ? "rgba(239,68,68,0.10)" : "rgba(34,197,94,0.08)";
  const border = inWindow ? "var(--bearish)" : "var(--bullish)";
  const fg = inWindow ? "var(--bearish)" : "var(--on-surface)";
  const daysStr = days != null ? `${days}d away` : "date set";
  const expiryStr = expiry ?? "—";
  const headline = inWindow
    ? `Earnings ${date} (${daysStr}) — expiry ${expiryStr} STRADDLES the print`
    : `Earnings ${date} (${daysStr}) — expiry ${expiryStr} finishes ≥ 2d before`;
  const sub = inWindow
    ? "Conservative profile: order disabled. No pre-earnings expiry available in the chain (or chain edge limited)."
    : `Buffer satisfied: trade exits before ${pick.earningsBufferDate ?? date}.`;
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        padding: "8px 10px",
        marginTop: 6,
        marginBottom: 2,
        fontSize: 11.5,
        color: fg,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 600 }}>{headline}</div>
      <div style={{ fontSize: 10.5, color: "var(--on-surface-variant)", marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

function executableLegPrice(leg: ContractLeg): { price: number | null; source: "mid" | "bid" | "ask" | "last" } {
  const hasBid = leg.bid != null && leg.bid > 0;
  const hasAsk = leg.ask != null && leg.ask > 0;
  if (hasBid && hasAsk) return { price: ((leg.bid as number) + (leg.ask as number)) / 2, source: "mid" };
  if (hasBid) return { price: leg.bid, source: "bid" };
  if (hasAsk) return { price: leg.ask, source: "ask" };
  if (leg.last != null) return { price: leg.last, source: "last" };
  return { price: null, source: "last" };
}

function ContractLegRow({ leg, side }: { leg: ContractLeg; side: "BUY" | "SELL" | "OPEN" | "CLOSE" }) {
  const sideCls =
    side === "BUY" || side === "OPEN" ? styles.legBuy : styles.legSell;
  const { price, source } = executableLegPrice(leg);
  const suffix = source === "mid" ? "" : ` (${source})`;
  return (
    <div className={styles.contractLeg}>
      <span className={styles.legSide + " " + sideCls}>{side}</span>
      <span className={styles.legDescription}>{leg.description}</span>
      {leg.delta !== null && leg.delta !== undefined && (
        <span className={styles.legGreek + " tabular-nums"}>Δ {leg.delta.toFixed(2)}</span>
      )}
      {price !== null && (
        <span
          className={styles.legPrice + " tabular-nums"}
          title={
            source === "mid"
              ? `Bid/ask mid: ($${leg.bid?.toFixed(2)} + $${leg.ask?.toFixed(2)}) / 2 = $${price.toFixed(2)}`
              : `${source} price (no bid/ask mid available)`
          }
        >
          ${price.toFixed(2)}{suffix}
        </span>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const cls = tone === "bullish" ? styles.bullish : tone === "bearish" ? styles.bearish : "";
  return (
    <span className={styles.adjChip + (cls ? " " + cls : "")}>
      <span className={styles.adjChipLabel}>{label}</span>
      <span className={styles.adjChipValue}>{value}</span>
    </span>
  );
}
