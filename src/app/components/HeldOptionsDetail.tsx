"use client";

import type { HeldGroup, Position } from "../../lib/types";
import styles from "../page.module.css";
import { fmtMoney, fmtNum, fmtSigned } from "./format";

const GROUP_LABEL: Record<HeldGroup["kind"], string> = {
  STOCK: "Stock",
  BULL_PUT_SPREAD: "Bull Put Spread",
  BEAR_PUT_SPREAD: "Bear Put Spread",
  BULL_CALL_SPREAD: "Bull Call Spread",
  BEAR_CALL_SPREAD: "Bear Call Spread",
  IRON_CONDOR: "Iron Condor",
  COVERED_CALL: "Covered Call",
  CSP: "Cash-Secured Put",
  LONG_CALL: "Long Call",
  LONG_PUT: "Long Put",
  SHORT_CALL: "Short Call",
  SHORT_PUT: "Short Put",
  CUSTOM: "Custom Structure",
};

function fmtIso(iso: string): string {
  if (!iso) return "";
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function strikeRange(g: HeldGroup): string {
  const strikes = g.legs
    .filter((l) => l.assetClass === "OPT")
    .map((l) => l.strike)
    .filter((s): s is number => s != null)
    .sort((a, b) => a - b);
  if (strikes.length === 0) return "";
  if (strikes.length === 1) return String(strikes[0]);
  return `${strikes[0]}/${strikes[strikes.length - 1]}`;
}

export function HeldOptionsDetail({ groups }: { groups: HeldGroup[] }) {
  const optionGroups = groups.filter((g) => g.kind !== "STOCK");
  if (optionGroups.length === 0) return null;
  return (
    <section className={styles.heldOptionsDetail}>
      <div className={styles.heldOptionsHeader + " font-display"}>Held Options</div>
      <div className={styles.heldOptionsList}>
        {optionGroups.map((g, i) => (
          <HeldOptionGroupCard key={`hg-${g.underlying}-${g.expiry}-${i}`} group={g} />
        ))}
      </div>
    </section>
  );
}

function HeldOptionGroupCard({ group: g }: { group: HeldGroup }) {
  const currency = g.legs[0]?.currency ?? "USD";
  const triggers: { label: string; tone: "bullish" | "bearish" | "neutral" }[] = [];
  if (g.triggers.pt50Hit) triggers.push({ label: "50% PT hit", tone: "bullish" });
  if (g.triggers.dteUnder21) triggers.push({ label: `${g.dte} DTE`, tone: "bearish" });
  if (g.triggers.stopBreached) triggers.push({ label: "Stop breached", tone: "bearish" });
  const range = strikeRange(g);

  return (
    <div className={styles.heldOptionsCard}>
      <div className={styles.heldOptionsCardHeader}>
        <div className={styles.heldOptionsTitle}>
          <strong>{GROUP_LABEL[g.kind]}{range ? ` ${range}` : ""}</strong>
          <span className={styles.heldOptionsSub}>{g.underlying} · {fmtIso(g.expiry)}</span>
        </div>
        <div className={styles.heldOptionsTriggers}>
          {triggers.map((t) => (
            <span
              key={t.label}
              className={`${styles.adjChip} ${t.tone === "bullish" ? styles.bullish : t.tone === "bearish" ? styles.bearish : ""}`}
            >
              <span className={styles.adjChipLabel}>!</span>
              <span className={styles.adjChipValue}>{t.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.heldOptionsLegs}>
        {g.legs.map((leg) => (
          <LegRow key={`leg-${leg.conid}`} leg={leg} />
        ))}
      </div>

      <div className={styles.adjustmentChips}>
        <span className={styles.adjChip}>
          <span className={styles.adjChipLabel}>{g.openCredit >= 0 ? "Open credit" : "Open debit"}</span>
          <span className={styles.adjChipValue + " tabular-nums"}>{fmtMoney(Math.abs(g.openCredit), currency)}</span>
        </span>
        <span className={styles.adjChip}>
          <span className={styles.adjChipLabel}>{g.liveClose >= 0 ? "Live close cr." : "Live close db."}</span>
          <span className={styles.adjChipValue + " tabular-nums"}>{fmtMoney(Math.abs(g.liveClose), currency)}</span>
        </span>
        <span className={`${styles.adjChip} ${g.pnl >= 0 ? styles.bullish : styles.bearish}`}>
          <span className={styles.adjChipLabel}>P/L</span>
          <span className={styles.adjChipValue + " tabular-nums"}>
            {fmtSigned(g.pnl, currency)}
            {g.pnlPctOfMax !== null ? ` (${(g.pnlPctOfMax * 100).toFixed(1)}%)` : ""}
          </span>
        </span>
        <span className={styles.adjChip}>
          <span className={styles.adjChipLabel}>DTE</span>
          <span className={styles.adjChipValue + " tabular-nums"}>{g.dte}</span>
        </span>
        <span className={styles.adjChip}>
          <span className={styles.adjChipLabel}>Suggestion</span>
          <span className={styles.adjChipValue}>{g.suggestion}</span>
        </span>
      </div>

      {g.dataIssue && <div className={styles.heldOptionsDataIssue}>{g.dataIssue}</div>}
    </div>
  );
}

function LegRow({ leg }: { leg: Position }) {
  const right = leg.putOrCall === "C" ? "CALL" : leg.putOrCall === "P" ? "PUT" : leg.assetClass;
  const sideCls = leg.position > 0 ? styles.legBuy : styles.legSell;
  const sideLabel = leg.position > 0 ? "+" : "";
  return (
    <div className={styles.contractLeg}>
      <span className={styles.legSide + " " + sideCls}>{sideLabel}{leg.position}</span>
      <span className={styles.legDescription}>
        {leg.strike ?? ""}{leg.strike != null && right ? " " : ""}{right}
      </span>
      {leg.liveGreeks?.delta != null && (
        <span className={styles.legGreek + " tabular-nums"}>Δ {leg.liveGreeks.delta.toFixed(2)}</span>
      )}
      <span className={styles.legPrice + " tabular-nums"}>@ {fmtNum(leg.avgCost / 100)} / now {fmtNum(leg.mktPrice)}</span>
    </div>
  );
}
