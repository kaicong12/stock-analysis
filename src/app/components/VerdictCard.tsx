// Verdict card — the dual-sleeve synthesis: confidence, actions, rationale, risk.

"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MarkdownInline } from "./Markdown";
import type {
  DashboardData,
  DerivativesAction,
  PositionAdjustment,
  SleeveDirection,
  SleeveVerdict,
  StockAction,
} from "../../lib/types";
import { ArrowDown, Minus, Play, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

type Tone = "bullish" | "bearish" | "neutral";
type IconCmp = React.ComponentType<{ className?: string }>;

// Puts a confidence score into words; the thresholds mirror synth.ts.
function confidenceInterpretation(c: number): string {
  if (c >= 90) return "Rare — overwhelming alignment, used sparingly";
  if (c >= 75) return "Strong conviction — clear thesis with corroboration";
  if (c >= 65) return "Decent conviction — multiple panels aligned";
  if (c >= 55) return "Weak lean — directional signal present but not strong";
  return "Coin-flip — panels disagree, no edge";
}

// Entry-or-pass only: with no portfolio feed the app cannot advise on managing a position.
const STOCK_ACTION_META: Record<StockAction, { label: string; baseIcon: IconCmp }> = {
  OPEN: { label: "Open Position", baseIcon: TrendingUp },
  PASS: { label: "Pass", baseIcon: Minus },
};

const DERIVATIVES_ACTION_META: Record<DerivativesAction, { label: string; baseIcon: IconCmp; defaultTone: Tone }> = {
  SELL_CASH_SECURED_PUT: { label: "Sell Cash-Secured Put", baseIcon: TrendingUp, defaultTone: "bullish" },
  SELL_COVERED_CALL: { label: "Sell Covered Call", baseIcon: TrendingDown, defaultTone: "neutral" },
  PASS: { label: "Pass", baseIcon: Minus, defaultTone: "neutral" },
};

const DIRECTION_TONE: Record<SleeveDirection, Tone> = {
  bullish: "bullish",
  bearish: "bearish",
  neutral: "neutral",
};

const TONE_CLS: Record<Tone, string> = {
  bullish: "text-bullish",
  bearish: "text-bearish",
  neutral: "text-neutral",
};

const CAPS = "text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant";
const TILE = "rounded border border-outline-variant bg-surface-low";

/** Renders the verdict: confidence column, both sleeves, rationale and risk. */
export function VerdictCard({ data }: { data: DashboardData }) {
  const v = data.verdict!;
  const generated = new Date(data.generatedAt);
  const generatedStr = new Intl.DateTimeFormat("en-SG", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(generated);

  return (
    <Card className="grid grid-cols-[200px_1fr] items-stretch gap-6 border-outline-variant bg-linear-to-b from-surface-high to-surface-container px-6 py-[22px] max-[1024px]:grid-cols-1">
      <div className="-mb-1 col-span-full flex items-center justify-between">
        <div className="inline-flex items-center gap-2 font-heading text-base font-semibold text-on-surface [&_svg]:size-4 [&_svg]:text-tertiary">
          <Sparkles />
          Alpha Insight Synthesis
        </div>
        <div className="text-[11px] font-semibold tracking-[0.05em] uppercase text-on-surface-variant tabular-nums">
          Generated {generatedStr}
        </div>
      </div>

      <div className={cn("flex flex-col items-stretch justify-between gap-2.5 px-3.5 py-3", TILE)}>
        <ConfidenceMeter label="Stock" value={v.stock.confidence} />
        <ConfidenceMeter label="Wheel" value={v.derivatives.confidence} labelClassName="mt-3" />
      </div>

      <div className="grid grid-cols-2 items-stretch gap-4 max-[1024px]:grid-cols-1">
        <StockSleeve sleeve={v.stock} />
        <DerivativesSleeve sleeve={v.derivatives} />
      </div>

      <p className="col-span-full text-[13.5px] leading-[1.65] text-on-surface">
        <MarkdownInline>{v.rationale}</MarkdownInline>
      </p>
      <div className="col-span-full mt-1 flex items-start gap-2 border-t border-outline-variant pt-2 text-[12.5px] leading-[1.55] text-on-surface-variant">
        <strong className="mt-0.5 shrink-0 text-[11px] font-semibold tracking-[0.04em] uppercase text-bearish">
          Risk
        </strong>
        <span>
          <MarkdownInline>{v.riskFactor}</MarkdownInline>
        </span>
      </div>
    </Card>
  );
}

// Renders one confidence score as flat siblings, so each line joins the column's justify-between.
function ConfidenceMeter({ label, value, labelClassName }: { label: string; value: number; labelClassName?: string }) {
  return (
    <>
      <div className={cn(CAPS, labelClassName)}>{label}</div>
      <div className="font-heading text-4xl leading-none font-semibold text-tertiary tabular-nums">
        {value}%
      </div>
      <div className="-mt-1 text-xs leading-[1.35] font-medium text-on-surface-variant">
        {confidenceInterpretation(value)}
      </div>
      <Progress
        value={Math.max(2, Math.min(100, value))}
        className="h-1 rounded-[2px] bg-surface-highest [&>[data-slot=progress-indicator]]:bg-tertiary"
      />
    </>
  );
}

// Renders the stock sleeve, toned by its directional bias.
function StockSleeve({ sleeve }: { sleeve: SleeveVerdict<StockAction> }) {
  const meta = STOCK_ACTION_META[sleeve.action];
  const tone: Tone = DIRECTION_TONE[sleeve.direction];
  return (
    <Sleeve label="Stock Sleeve" action={meta.label} icon={meta.baseIcon} tone={tone}>
      <AdjustmentBlock adj={sleeve.adjustment} />
    </Sleeve>
  );
}

// Renders the wheel sleeve and its pointer to the strike desk.
function DerivativesSleeve({ sleeve }: { sleeve: SleeveVerdict<DerivativesAction> }) {
  const meta = DERIVATIVES_ACTION_META[sleeve.action];
  const tone: Tone = sleeve.action === "PASS" ? DIRECTION_TONE[sleeve.direction] : meta.defaultTone;
  return (
    <Sleeve label="Wheel Sleeve" action={meta.label} icon={meta.baseIcon} tone={tone}>
      <AdjustmentBlock adj={sleeve.adjustment} />
      <div className="mt-3 flex items-center gap-2 rounded border border-outline-variant bg-surface-container px-3 py-2.5 text-[11px] font-semibold tracking-[0.04em] uppercase text-on-surface-variant">
        <ArrowDown className="size-3 text-tertiary" />
        Strike desk below
      </div>
    </Sleeve>
  );
}

// Renders the tile chrome shared by both sleeves: label, action row, then children.
function Sleeve({
  label,
  action,
  icon: Icon,
  tone,
  children,
}: {
  label: string;
  action: string;
  icon: IconCmp;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5 px-3.5 pt-3.5 pb-3", TILE)}>
      <div className="text-[10.5px] font-bold tracking-[0.08em] uppercase text-on-surface-variant">
        {label}
      </div>
      <div className={cn("flex items-center gap-3 px-3 py-2.5", TILE)}>
        <span className={CAPS}>Action</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-2 font-heading text-lg leading-normal font-semibold",
            TONE_CLS[tone],
          )}
        >
          <Icon className="size-4" />
          {action}
        </span>
      </div>
      {children}
    </div>
  );
}

// Renders the what-to-do instruction and whichever adjustment chips are present.
function AdjustmentBlock({ adj }: { adj: PositionAdjustment }) {
  const chips: { label: string; value: string; tone?: "bullish" | "bearish" }[] = [];
  if (adj.sizing) chips.push({ label: "Size", value: adj.sizing });
  if (adj.entry) chips.push({ label: "Entry", value: adj.entry });
  if (adj.stop) chips.push({ label: "Stop", value: adj.stop, tone: "bearish" });
  if (adj.target) chips.push({ label: "Target", value: adj.target, tone: "bullish" });
  if (adj.timeframe) chips.push({ label: "Timeframe", value: adj.timeframe });
  return (
    <div className="relative flex flex-col gap-2.5 rounded border border-tertiary bg-surface-low px-3.5 py-3">
      <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.08em] uppercase text-tertiary">
        <Play className="size-3 fill-current" /> What to do
      </div>
      <p className="text-sm leading-[1.55] font-medium text-on-surface">
        <MarkdownInline>{adj.instruction}</MarkdownInline>
      </p>
      {chips.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c.label}
              className={cn(
                "inline-flex min-w-[72px] flex-col gap-px rounded border border-outline-variant bg-surface-container px-2.5 py-1.5",
                c.tone === "bullish" && "border-bullish/50",
                c.tone === "bearish" && "border-bearish/50",
              )}
            >
              <span className="text-[9.5px] font-bold tracking-[0.08em] uppercase text-on-surface-variant">
                {c.label}
              </span>
              <span className="text-[12.5px] font-semibold text-on-surface tabular-nums">{c.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
