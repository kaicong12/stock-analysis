"use client";

import styles from "../page.module.css";
import { MarkdownInline } from "./Markdown";
import type {
  DashboardData,
  DerivativesAction,
  PositionAdjustment,
  SleeveDirection,
  SleeveVerdict,
  StockAction,
} from "../../lib/types";
import { WheelPane } from "./WheelPane";
import {
  IconArrowDown,
  IconArrowUp,
  IconHold,
  IconPlay,
  IconSparkle,
} from "./icons";

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

// Entry-or-pass only — the app has no portfolio feed, so it can't advise on
// managing a position it can't see. See the action unions in lib/types.ts.
const STOCK_ACTION_META: Record<StockAction, { label: string; baseIcon: IconCmp }> = {
  OPEN: { label: "Open Position", baseIcon: IconArrowUp },
  PASS: { label: "Pass", baseIcon: IconHold },
};

const DERIVATIVES_ACTION_META: Record<DerivativesAction, { label: string; baseIcon: IconCmp; defaultTone: Tone }> = {
  SELL_CASH_SECURED_PUT: { label: "Sell Cash-Secured Put", baseIcon: IconArrowUp, defaultTone: "bullish" },
  SELL_COVERED_CALL: { label: "Sell Covered Call", baseIcon: IconArrowDown, defaultTone: "neutral" },
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

export function VerdictCard({ data }: { data: DashboardData }) {
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
        <div className={styles.confidenceLabel} style={{ marginTop: 12 }}>Wheel</div>
        <div className={styles.confidenceValue + " font-display"}>{v.derivatives.confidence}%</div>
        <div className={styles.confidenceInterpretation}>{confidenceInterpretation(v.derivatives.confidence)}</div>
        <div className={styles.confidenceTrack}><div className={styles.confidenceFill} style={{ width: `${Math.max(2, Math.min(100, v.derivatives.confidence))}%` }} /></div>
      </div>

      <div className={styles.sleeveGrid}>
        <StockSleeve sleeve={v.stock} />
        <DerivativesSleeve sleeve={v.derivatives} symbol={data.symbol} ticker={data.ticker} />
      </div>

      <p className={styles.rationale}><MarkdownInline>{v.rationale}</MarkdownInline></p>
      <div className={styles.riskRow}>
        <strong>Risk</strong>
        <span><MarkdownInline>{v.riskFactor}</MarkdownInline></span>
      </div>
    </section>
  );
}

function StockSleeve({ sleeve }: { sleeve: SleeveVerdict<StockAction> }) {
  const meta = STOCK_ACTION_META[sleeve.action];
  // Both OPEN and PASS take their tone from the sleeve's directional bias.
  const tone: Tone = DIRECTION_TONE[sleeve.direction];
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
  symbol,
  ticker,
}: {
  sleeve: SleeveVerdict<DerivativesAction>;
  symbol: string;
  ticker: string;
}) {
  const meta = DERIVATIVES_ACTION_META[sleeve.action];
  // PASS has no structure of its own, so it reads off the directional bias;
  // every entry action carries its own inherent tone.
  const tone: Tone = sleeve.action === "PASS" ? DIRECTION_TONE[sleeve.direction] : meta.defaultTone;
  const Icon = meta.baseIcon;
  return (
    <div className={styles.sleeve}>
      <div className={styles.sleeveLabel}>Wheel Sleeve</div>
      <div className={styles.actionRow}>
        <span className={styles.actionLabel}>Action</span>
        <span className={styles.actionTitle + " " + toneCls(tone)}>
          <Icon className={styles.actionIcon} />
          {meta.label}
        </span>
      </div>
      <AdjustmentBlock adj={sleeve.adjustment} />
      <WheelPane symbol={symbol} ticker={ticker} />
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
      <p className={styles.adjustmentInstruction}>
        <MarkdownInline>{adj.instruction}</MarkdownInline>
      </p>
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

