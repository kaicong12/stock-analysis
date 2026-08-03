"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";
import { fmtNum } from "./format";
import { MarkdownInline } from "./Markdown";
import type {
  DashboardData,
  DerivativesAction,
  LevelsSnapshot,
  PositionAdjustment,
  SleeveDirection,
  SleeveVerdict,
  StockAction,
} from "../../lib/types";
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
  SELL_PUT_SPREAD: { label: "Sell Put Spread", baseIcon: IconArrowUp, defaultTone: "bullish" },
  SELL_CALL_SPREAD: { label: "Sell Call Spread", baseIcon: IconArrowDown, defaultTone: "bearish" },
  SELL_COVERED_CALL: { label: "Sell Covered Call", baseIcon: IconHold, defaultTone: "neutral" },
  SELL_CASH_SECURED_PUT: { label: "Sell Cash-Secured Put", baseIcon: IconHold, defaultTone: "neutral" },
  IRON_CONDOR: { label: "Iron Condor", baseIcon: IconHold, defaultTone: "neutral" },
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
      <div className={styles.sleeveLabel}>Derivatives Sleeve</div>
      <div className={styles.actionRow}>
        <span className={styles.actionLabel}>Action</span>
        <span className={styles.actionTitle + " " + toneCls(tone)}>
          <Icon className={styles.actionIcon} />
          {meta.label}
        </span>
      </div>
      <AdjustmentBlock adj={sleeve.adjustment} />
      <ExpectedMoveWhatIf symbol={symbol} ticker={ticker} />
    </div>
  );
}

// What-if expected-move calculator for a NEW spread you're about to open at your
// broker. Spot + support/resistance come from /api/levels (both IV/DTE-independent);
// the expected move is computed CLIENT-SIDE from the IV and DTE the user types, so
// it updates live as they tune the expiry they're eyeing. The conservative edge: a
// short put goes below BOTH support and EM.lower; a short call above BOTH
// resistance and EM.upper — whichever is further out wins.
function ExpectedMoveWhatIf({ symbol, ticker }: { symbol: string; ticker: string }) {
  const [snap, setSnap] = useState<LevelsSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [iv, setIv] = useState("");   // annualized IV in PERCENT, e.g. "30"
  const [dte, setDte] = useState(""); // days to expiry

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // No dte param: spot + support/resistance don't depend on it, and we
        // compute the expected move ourselves from the user's inputs.
        const res = await fetch(`/api/levels?symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { snapshot: LevelsSnapshot };
        if (alive) {
          setSnap(json.snapshot);
          setState("ready");
        }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [symbol]);

  const spot = snap?.spot ?? null;
  const support = snap?.support ?? null;
  const resistance = snap?.resistance ?? null;

  const ivNum = Number(iv) / 100;
  const dteNum = Number(dte);
  const inputsValid =
    spot != null &&
    iv.trim() !== "" && Number.isFinite(ivNum) && ivNum > 0 &&
    dte.trim() !== "" && Number.isFinite(dteNum) && dteNum > 0;

  const move = inputsValid ? spot! * ivNum * Math.sqrt(dteNum / 365) : null;
  const lower = move != null ? spot! - move : null;
  const upper = move != null ? spot! + move : null;
  const movePct = move != null ? (move / spot!) * 100 : null;

  // Safe short strikes: further-OTM of the structural and statistical bounds.
  const putFloor = lower != null ? (support != null ? Math.min(support, lower) : lower) : null;
  const callCeil = upper != null ? (resistance != null ? Math.max(resistance, upper) : upper) : null;

  return (
    <div className={styles.whatIf}>
      <div className={styles.whatIfHeader}>
        <IconPlay /> Expected-move check — {ticker}
      </div>
      <div className={styles.whatIfSub}>
        Enter the IV and DTE of the expiry you&apos;re eyeing at your broker; the move is computed live.
      </div>

      <div className={styles.whatIfInputs}>
        <label className={styles.whatIfField}>
          <span>IV %</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 30"
            value={iv}
            onChange={(e) => setIv(e.target.value)}
            className={styles.whatIfInput + " tabular-nums"}
          />
        </label>
        <label className={styles.whatIfField}>
          <span>DTE (days)</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 30"
            value={dte}
            onChange={(e) => setDte(e.target.value)}
            className={styles.whatIfInput + " tabular-nums"}
          />
        </label>
      </div>

      {state === "loading" && <div className={styles.whatIfNote}>Loading spot &amp; levels…</div>}
      {state === "error" && <div className={styles.whatIfNote}>Spot &amp; levels unavailable — can&apos;t compute.</div>}

      {state === "ready" && (
        <>
          <div className={styles.whatIfRow}>
            <span className={styles.whatIfLabel}>Spot</span>
            <span className="tabular-nums">{spot != null ? fmtNum(spot) : "—"}</span>
          </div>
          <div className={styles.whatIfRow}>
            <span className={styles.whatIfLabel}>Support / Resistance</span>
            <span className="tabular-nums">
              {support != null ? fmtNum(support) : "—"} / {resistance != null ? fmtNum(resistance) : "—"}
            </span>
          </div>

          {move == null ? (
            <div className={styles.whatIfNote}>Enter IV and DTE to compute the expected move.</div>
          ) : (
            <>
              <div className={styles.whatIfRow}>
                <span className={styles.whatIfLabel}>Expected move (1-SD)</span>
                <span className="tabular-nums">
                  ±{fmtNum(move)} (±{movePct!.toFixed(1)}%) · {fmtNum(lower!)} – {fmtNum(upper!)}
                </span>
              </div>
              <div className={styles.whatIfGuide}>
                <div>
                  <strong>Sell-put side:</strong> short put <em>below</em>{" "}
                  <span className="tabular-nums">{fmtNum(putFloor!)}</span>{" "}
                  {support != null && lower != null
                    ? `(lower of support ${fmtNum(support)} & EM ${fmtNum(lower)})`
                    : "(EM lower bound)"}
                </div>
                <div>
                  <strong>Sell-call side:</strong> short call <em>above</em>{" "}
                  <span className="tabular-nums">{fmtNum(callCeil!)}</span>{" "}
                  {resistance != null && upper != null
                    ? `(higher of resistance ${fmtNum(resistance)} & EM ${fmtNum(upper)})`
                    : "(EM upper bound)"}
                </div>
              </div>
            </>
          )}
        </>
      )}
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

