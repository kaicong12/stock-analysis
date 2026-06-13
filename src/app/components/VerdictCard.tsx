"use client";

import styles from "../page.module.css";
import type {
  DashboardData,
  DerivativesAction,
  PositionAdjustment,
  SleeveDirection,
  SleeveVerdict,
  StockAction,
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
        <div className={styles.confidenceLabel} style={{ marginTop: 12 }}>Derivatives</div>
        <div className={styles.confidenceValue + " font-display"}>{v.derivatives.confidence}%</div>
        <div className={styles.confidenceInterpretation}>{confidenceInterpretation(v.derivatives.confidence)}</div>
        <div className={styles.confidenceTrack}><div className={styles.confidenceFill} style={{ width: `${Math.max(2, Math.min(100, v.derivatives.confidence))}%` }} /></div>
      </div>

      <div className={styles.sleeveGrid}>
        <StockSleeve sleeve={v.stock} />
        <DerivativesSleeve sleeve={v.derivatives} />
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

function DerivativesSleeve({ sleeve }: { sleeve: SleeveVerdict<DerivativesAction> }) {
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

