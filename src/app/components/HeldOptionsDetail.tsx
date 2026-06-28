"use client";

import { useEffect, useState } from "react";
import type { HeldGroup, JournalCloseLeg, LevelsSnapshot, Position } from "../../lib/types";
import type { JournalStrategy, JournalTradeWithLegs } from "../../lib/journal/types";
import { evalShortLegs } from "../../lib/positions/levels";
import styles from "../page.module.css";
import { fmtMoney, fmtNum, fmtSigned } from "./format";
import { OrderModal, type OrderModalIntent } from "./OrderModal";

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

const SPREAD_KINDS = new Set<HeldGroup["kind"]>([
  "BULL_PUT_SPREAD", "BEAR_PUT_SPREAD", "BULL_CALL_SPREAD", "BEAR_CALL_SPREAD", "IRON_CONDOR",
]);

// Debit spreads have openCredit < 0 (you paid premium on open); max loss is
// simply the debit paid. Credit spreads have openCredit > 0 and max loss is
// the spread width minus the credit, scaled by contracts.
function computeMaxLoss(g: HeldGroup): number | null {
  if (!SPREAD_KINDS.has(g.kind)) return null;
  const optLegs = g.legs.filter((l) => l.assetClass === "OPT" && l.strike != null);
  if (optLegs.length < 2) return null;
  if (g.openCredit < 0) return -g.openCredit;
  const qty = Math.max(...optLegs.map((l) => Math.abs(l.position)), 1);
  if (g.kind === "IRON_CONDOR") {
    const putStrikes = optLegs.filter((l) => l.putOrCall === "P").map((l) => l.strike!).sort((a, b) => a - b);
    const callStrikes = optLegs.filter((l) => l.putOrCall === "C").map((l) => l.strike!).sort((a, b) => a - b);
    if (putStrikes.length < 2 || callStrikes.length < 2) return null;
    const maxWidth = Math.max(
      putStrikes[putStrikes.length - 1] - putStrikes[0],
      callStrikes[callStrikes.length - 1] - callStrikes[0],
    );
    return maxWidth * qty * 100 - g.openCredit;
  }
  const strikes = optLegs.map((l) => l.strike!).sort((a, b) => a - b);
  const spreadWidth = strikes[strikes.length - 1] - strikes[0];
  return spreadWidth * qty * 100 - g.openCredit;
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

export function HeldOptionsDetail({ groups, symbol }: { groups: HeldGroup[]; symbol: string }) {
  const optionGroups = groups
    .filter((g) => g.kind !== "STOCK")
    .slice()
    .sort((a, b) => a.dte - b.dte);
  if (optionGroups.length === 0) return null;
  return (
    <section className={styles.heldOptionsDetail}>
      <div className={styles.heldOptionsHeader + " font-display"}>Held Options</div>
      <div className={styles.heldOptionsList}>
        {optionGroups.map((g, i) => (
          <HeldOptionGroupCard key={`hg-${g.underlying}-${g.expiry}-${i}`} group={g} symbol={symbol} />
        ))}
      </div>
    </section>
  );
}

function LevelsPanel({ group, symbol }: { group: HeldGroup; symbol: string }) {
  const [snap, setSnap] = useState<LevelsSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Pass the position's DTE so vol is sampled at the position's expiry —
        // IV is DTE-specific, so a 19-DTE spread must not get a 30-DTE move.
        const res = await fetch(
          `/api/levels?symbol=${encodeURIComponent(symbol)}&dte=${group.dte}`,
        );
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
  }, [symbol, group.dte]);

  if (state === "loading") return <div className={styles.levelsPanel}>Loading live levels…</div>;
  if (state === "error" || !snap) {
    return <div className={styles.levelsPanel}>Live levels unavailable for {group.underlying}.</div>;
  }

  const em = snap.expectedMove;
  const legs = evalShortLegs(group, snap);

  return (
    <div className={styles.levelsPanel}>
      <div className={styles.levelsSummary}>
        <span className={styles.levelsItem}>
          <span className={styles.levelsItemLabel}>Spot</span>
          <span className={styles.levelsItemValue + " tabular-nums"}>{snap.spot != null ? fmtNum(snap.spot) : "—"}</span>
        </span>
        <span className={styles.levelsItem}>
          <span className={styles.levelsItemLabel}>Expected move</span>
          <span className={styles.levelsItemValue + " tabular-nums"}>
            {em ? `±${fmtNum(em.move)} (±${em.movePct.toFixed(1)}%) · ${em.dte}d` : "—"}
          </span>
        </span>
        <span className={styles.levelsItem}>
          <span className={styles.levelsItemLabel}>EM range</span>
          <span className={styles.levelsItemValue + " tabular-nums"}>
            {em ? `${fmtNum(em.lower)} – ${fmtNum(em.upper)}` : "—"}
          </span>
        </span>
        <span className={styles.levelsItem}>
          <span className={styles.levelsItemLabel}>Support / Resistance</span>
          <span className={styles.levelsItemValue + " tabular-nums"}>
            {snap.support != null ? fmtNum(snap.support) : "—"} / {snap.resistance != null ? fmtNum(snap.resistance) : "—"}
          </span>
        </span>
      </div>

      {legs.length === 0 ? (
        <div className={styles.levelsNote}>No short option leg to monitor in this group.</div>
      ) : (
        <div className={styles.levelsLegs}>
          {legs.map((s) => {
            const toneCls = s.tone === "breached" ? styles.levelBreached : s.tone === "watch" ? styles.levelWatch : styles.levelOk;
            const sideLabel = s.side === "P" ? "Short put" : "Short call";
            const boundLabel = s.side === "P" ? "EM floor" : "EM ceiling";
            const levelLabel = s.side === "P" ? "support" : "resistance";
            const Level = `${levelLabel[0].toUpperCase()}${levelLabel.slice(1)}`;
            const verdict =
              s.tone === "breached"
                ? "Price has crossed the short strike — close."
                : s.tone === "watch"
                  ? s.levelBreached
                    ? `Strike now inside expected move (${levelLabel} also broken) — consider closing.`
                    : "Strike now inside expected move — exposed."
                  : s.levelBreached
                    ? `${Level} broken past strike, but expected move still has room — watch.`
                    : "Short strike still outside expected move — OK.";
            return (
              <div key={s.conid} className={`${styles.levelsLegRow} ${toneCls}`}>
                <span className={styles.levelsLegHead + " tabular-nums"}>
                  {sideLabel} {fmtNum(s.strike)}
                </span>
                <span className={styles.levelsLegDetail + " tabular-nums"}>
                  {boundLabel} {s.emBound != null ? fmtNum(s.emBound) : "—"}
                  {s.emInside ? " (inside)" : ""} · {levelLabel} {s.level != null ? fmtNum(s.level) : "—"}
                </span>
                <span className={styles.levelsLegVerdict}>{verdict}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className={styles.levelsNote}>
        Levels recomputed live{snap.asOf ? ` (as of ${fmtIso(snap.asOf)})` : ""}; the short strike is fixed — watch for the
        bound to cross it.
      </div>
    </div>
  );
}

const HELD_TO_JOURNAL_STRATEGY: Partial<Record<HeldGroup["kind"], JournalStrategy>> = {
  BULL_PUT_SPREAD: "SELL_PUT_SPREAD",
  BEAR_CALL_SPREAD: "SELL_CALL_SPREAD",
  BULL_CALL_SPREAD: "BUY_CALL_SPREAD",
  BEAR_PUT_SPREAD: "BUY_PUT_SPREAD",
  IRON_CONDOR: "IRON_CONDOR",
  COVERED_CALL: "SELL_COVERED_CALL",
  CSP: "SELL_CASH_SECURED_PUT",
  LONG_CALL: "LONG_CALL",
  LONG_PUT: "LONG_PUT",
  SHORT_CALL: "CUSTOM",
  SHORT_PUT: "CUSTOM",
  CUSTOM: "CUSTOM",
};

// Closing-leg metadata for the journal modal. Each leg's ratio is the *closing*
// sign — opposite of the held position's sign (held +n long closes with
// ratio -1 SELL; held -n short closes with ratio +1 BUY).
function legsForClose(g: HeldGroup): JournalCloseLeg[] {
  return g.legs
    .filter((l) => l.assetClass === "OPT" && l.putOrCall && l.strike != null && l.expiry)
    .map<JournalCloseLeg>((l) => ({
      side: (l.putOrCall === "C" ? "C" : "P") as "C" | "P",
      strike: l.strike as number,
      expiry: l.expiry as string,
      ratio: l.position > 0 ? -1 : 1,
      lastPrice: l.mktPrice ?? null,
    }));
}

// Try to find an open journal trade whose legs match this held group. We use
// the conid-set as the matching key — every option position has a unique
// conid, so a set equality across opt legs is a precise match.
async function findJournalTradeIdForGroup(g: HeldGroup): Promise<number | null> {
  try {
    const res = await fetch(`/api/journal?status=open&ticker=${encodeURIComponent(g.underlying)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { trades: JournalTradeWithLegs[] };
    const heldConids = new Set(
      g.legs.filter((l) => l.assetClass === "OPT").map((l) => l.conid),
    );
    for (const t of json.trades) {
      const tradeConids = new Set(t.legs.map((l) => l.conid).filter((c): c is number => c != null));
      if (tradeConids.size === 0) continue;
      if (tradeConids.size !== heldConids.size) continue;
      let match = true;
      for (const c of tradeConids) if (!heldConids.has(c)) { match = false; break; }
      if (match) return t.id;
    }
    return null;
  } catch {
    return null;
  }
}

function HeldOptionGroupCard({ group: g, symbol }: { group: HeldGroup; symbol: string }) {
  const currency = g.legs[0]?.currency ?? "USD";
  const [showLevels, setShowLevels] = useState(false);
  const triggers: { label: string; tone: "bullish" | "bearish" | "neutral" }[] = [];
  if (g.triggers.pt50Hit) triggers.push({ label: "50% PT hit", tone: "bullish" });
  if (g.triggers.dteUnder21) triggers.push({ label: `${g.dte} DTE`, tone: "bearish" });
  if (g.triggers.stopBreached) triggers.push({ label: "Stop breached", tone: "bearish" });
  const range = strikeRange(g);

  const maxLoss = computeMaxLoss(g);

  const [closing, setClosing] = useState(false);
  const [intent, setIntent] = useState<OrderModalIntent | null>(null);

  async function startClose() {
    setClosing(true);
    try {
      const optLegs = legsForClose(g);
      if (optLegs.length === 0) return;
      // Quantity: max absolute position across opt legs (handles spreads with
      // matched sizing; an unbalanced custom group falls back to the largest).
      const qty = Math.max(
        ...g.legs.filter((l) => l.assetClass === "OPT").map((l) => Math.abs(l.position) || 1),
        1,
      );
      // Convert liveClose (positive = receive cash) to signed per-contract
      // limit: positive = debit-to-pay, negative = credit-to-receive.
      const defaultLimitPrice = -g.liveClose / qty / 100;
      const journalTradeId = await findJournalTradeIdForGroup(g);
      const strategy = HELD_TO_JOURNAL_STRATEGY[g.kind] ?? "CUSTOM";
      setIntent({
        kind: "close-held",
        legs: optLegs,
        ticker: g.underlying,
        symbol: g.underlying,
        strategy,
        expiry: g.expiry,
        journalTradeId,
        defaultLimitPrice,
        defaultQuantity: qty,
        // openCredit is the structure-wide $; convert to per-contract net credit
        // (positive = received on open) for the PnL calc.
        originalNetCredit: qty > 0 ? g.openCredit / qty / 100 : null,
      });
    } finally {
      setClosing(false);
    }
  }

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
        {maxLoss !== null && (
          <span className={`${styles.adjChip} ${styles.bearish}`}>
            <span className={styles.adjChipLabel}>Max loss</span>
            <span className={styles.adjChipValue + " tabular-nums"}>-{fmtMoney(maxLoss, currency)}</span>
          </span>
        )}
        {maxLoss !== null && maxLoss > 0 && g.openCredit > 0 && (
          <span className={styles.adjChip}>
            <span className={styles.adjChipLabel}>ROC</span>
            <span className={styles.adjChipValue + " tabular-nums"}>{(g.openCredit / maxLoss * 100).toFixed(1)}%</span>
          </span>
        )}
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

      {showLevels && <LevelsPanel group={g} symbol={symbol} />}

      <div className={styles.journalActions} style={{ justifyContent: "space-between", marginTop: 8 }}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => setShowLevels((v) => !v)}
          aria-expanded={showLevels}
        >
          {showLevels ? "Hide levels" : "Expected move & levels"}
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={startClose}
          disabled={closing}
        >
          {closing ? "Preparing…" : "Log close to journal"}
        </button>
      </div>
      {intent && (
        <OrderModal
          intent={intent}
          onClose={() => setIntent(null)}
        />
      )}
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
