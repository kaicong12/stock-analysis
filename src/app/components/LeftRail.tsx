"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";
import type { HeldGroup, LevelsSnapshot, Portfolio } from "../../lib/types";
import { isOptionGroup } from "../../lib/positions/types";
import { evalShortLegs, worstTone, type LevelTone } from "../../lib/positions/levels";
import { fmtMoney, fmtNum, fmtSigned } from "./format";
import { JournalButton } from "./Journal";
import { CalendarButton } from "./Calendar";
import { ChecklistButton } from "./Checklist";

const GROUP_LABEL: Record<HeldGroup["kind"], string> = {
  STOCK: "Stock",
  BULL_PUT_SPREAD: "Bull Put",
  BEAR_PUT_SPREAD: "Bear Put",
  BULL_CALL_SPREAD: "Bull Call",
  BEAR_CALL_SPREAD: "Bear Call",
  IRON_CONDOR: "IC",
  COVERED_CALL: "Covered Call",
  CSP: "CSP",
  LONG_CALL: "Long Call",
  LONG_PUT: "Long Put",
  SHORT_CALL: "Short Call",
  SHORT_PUT: "Short Put",
  CUSTOM: "Custom",
};

function shortExpiry(iso: string): string {
  if (!iso) return "";
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]}${m[3]}`;
}

function strikeRange(g: HeldGroup): string {
  const opt = g.legs.filter((l) => l.assetClass === "OPT");
  if (opt.length === 0) return "";
  const strikes = opt.map((l) => l.strike).filter((s): s is number => s != null).sort((a, b) => a - b);
  if (strikes.length === 0) return "";
  if (strikes.length === 1) return String(strikes[0]);
  return `${strikes[0]}/${strikes[strikes.length - 1]}`;
}

export function LeftRail({
  portfolio,
  heldGroups,
  searchedTicker,
  onPickTicker,
}: {
  portfolio: Portfolio | null;
  heldGroups: HeldGroup[];
  searchedTicker: string;
  onPickTicker: (t: string) => void;
}) {
  const stocks = heldGroups.filter((g) => !isOptionGroup(g));
  const options = heldGroups.filter(isOptionGroup);
  return (
    <aside className={`${styles.leftRail} scrollbar-slim`}>
      <div className={styles.brandStack}>
        <div className={styles.brandLogo + " font-display"}>α</div>
        <div className={styles.brandName + " font-display"}>ALPHA TERM</div>
        <div className={styles.brandTag}>Terminal v0.1</div>
      </div>

      <PortfolioSnapshot portfolio={portfolio} />
      <StocksCard groups={stocks} searchedTicker={searchedTicker} onPickTicker={onPickTicker} />
      <OptionsCard groups={options} searchedTicker={searchedTicker} onPickTicker={onPickTicker} />
      <ChecklistButton />
      <JournalButton />
      <CalendarButton />
    </aside>
  );
}

function PortfolioSnapshot({ portfolio }: { portfolio: Portfolio | null }) {
  if (!portfolio) {
    return (
      <div className={styles.railCard}>
        <div className={styles.railCardHeader}>
          <span className={styles.railCardTitle}>Portfolio</span>
        </div>
        <div className={styles.railCardSub}>Loading…</div>
      </div>
    );
  }
  const cur = portfolio.summary.baseCurrency || "SGD";
  return (
    <div className={styles.railCard}>
      <div className={styles.railCardHeader}>
        <span className={styles.railCardTitle}>Net Liquidation</span>
        <span className={styles.railCardTitle}>{cur}</span>
      </div>
      <div className={`${styles.railCardValue} font-display tabular-nums`}>
        {fmtMoney(portfolio.summary.netLiquidation, cur)}
      </div>
      <div className={styles.railCardSub + " tabular-nums"}>
        {portfolio.accountId} · {portfolio.isPaper ? "paper" : portfolio.accountType.toLowerCase()}
      </div>
      <div className={styles.railRowList}>
        <div className={styles.railRow}><span>Cash</span><strong className="tabular-nums">{fmtMoney(portfolio.summary.totalCash, cur)}</strong></div>
        <div className={styles.railRow}><span>Available</span><strong className="tabular-nums">{fmtMoney(portfolio.summary.availableFunds, cur)}</strong></div>
        <div className={styles.railRow}><span>Buying power</span><strong className="tabular-nums">{fmtMoney(portfolio.summary.buyingPower, cur)}</strong></div>
        <div className={styles.railRow}><span>Gross positions</span><strong className="tabular-nums">{fmtMoney(portfolio.summary.grossPositionValue, cur)}</strong></div>
        <div className={styles.railRow}><span>Maint. margin</span><strong className="tabular-nums">{fmtMoney(portfolio.summary.maintMarginReq, cur)}</strong></div>
      </div>
    </div>
  );
}

function StocksCard({
  groups,
  searchedTicker,
  onPickTicker,
}: {
  groups: HeldGroup[];
  searchedTicker: string;
  onPickTicker: (t: string) => void;
}) {
  return (
    <div className={styles.railCard}>
      <div className={styles.railCardHeader}>
        <span className={styles.railCardTitle}>Stocks</span>
        <span className={styles.railCardTitle}>{groups.length}</span>
      </div>
      {groups.length === 0 ? (
        <div className={styles.railCardSub}>None</div>
      ) : (
        <div className={`${styles.railScroll} scrollbar-slim`}>
          <div className={styles.railRowList}>
            {groups.map((g) => {
              const totalShares = g.legs.reduce((acc, p) => acc + p.position, 0);
              const avgCost = g.legs.length > 0 ? g.legs[0].avgCost : 0;
              const currency = g.legs.length > 0 ? g.legs[0].currency : "USD";
              const isFocus = g.underlying === searchedTicker.toUpperCase();
              return (
                <button
                  key={`stock-${g.underlying}`}
                  type="button"
                  onClick={() => onPickTicker(g.underlying)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    padding: isFocus ? "6px 8px" : "2px 0",
                    marginLeft: isFocus ? -8 : 0,
                    marginRight: isFocus ? -8 : 0,
                    borderRadius: 4,
                    background: isFocus ? "var(--surface-container-high)" : "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, color: "var(--on-surface)" }}>
                    <span style={{ fontWeight: 600 }}>{g.underlying}</span>
                    <span className="tabular-nums" style={{ color: g.pnl >= 0 ? "var(--bullish)" : "var(--bearish)", fontWeight: 600 }}>
                      {fmtSigned(g.pnl, currency)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 11, color: "var(--on-surface-variant)" }}>
                    <span className="tabular-nums">{totalShares} sh @ {fmtNum(avgCost)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const LEVELS_TOOLTIP = [
  "EM ±x (lo–hi): 1-SD expected move — the range the options market prices over this expiry (spot ± move).",
  "S / R: nearest support (shown for short puts) or resistance (short calls) — the structural level your short strike should clear.",
  "⚠ inside: the expected move has reached your short strike — statistically exposed, consider closing.",
  "⚠ breached: price has crossed the short strike (in the money) — close.",
].join("\n");

// Compact live-levels line for a rail row: EM range + the level on the threatened
// short side(s), plus a breach tag. Null when there's no usable snapshot yet.
function levelsLine(
  g: HeldGroup,
  snap: LevelsSnapshot | null | undefined,
): { emText: string; levelText: string; tone: LevelTone; tag: string } | null {
  if (!snap) return null;
  const em = snap.expectedMove;
  // Always render EM (n/a when vol is unavailable) so it never silently drops.
  const emText = em ? `±${fmtNum(em.move)} (${fmtNum(em.lower)}–${fmtNum(em.upper)})` : "n/a";
  const shorts = evalShortLegs(g, snap);
  const lvl: string[] = [];
  if (shorts.some((s) => s.side === "P") && snap.support != null) lvl.push(`S ${fmtNum(snap.support)}`);
  if (shorts.some((s) => s.side === "C") && snap.resistance != null) lvl.push(`R ${fmtNum(snap.resistance)}`);
  const tone = shorts.length ? worstTone(shorts) : "ok";
  const tag = tone === "breached" ? "breached" : tone === "watch" ? "inside" : "";
  return { emText, levelText: lvl.join(" · "), tone, tag };
}

function OptionsCard({
  groups,
  searchedTicker,
  onPickTicker,
}: {
  groups: HeldGroup[];
  searchedTicker: string;
  onPickTicker: (t: string) => void;
}) {
  const sortedGroups = groups.slice().sort((a, b) => a.dte - b.dte);

  // Live levels for every name in the book, fetched in one batched POST. Keyed by
  // bare ticker (matches HeldGroup.underlying). fetchKey re-runs only when the set
  // of names or their DTEs changes, not on every render.
  const [snaps, setSnaps] = useState<Record<string, LevelsSnapshot | null>>({});
  const fetchKey = sortedGroups.map((g) => `${g.underlying}:${g.dte}`).join(",");
  useEffect(() => {
    const items = fetchKey
      ? fetchKey.split(",").map((s) => {
          const [symbol, dte] = s.split(":");
          return { symbol, dte: Number(dte) };
        })
      : [];
    if (items.length === 0) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/levels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { snapshots: Record<string, LevelsSnapshot | null> };
        if (alive) setSnaps(json.snapshots ?? {});
      } catch {
        /* leave empty — rows just omit the levels line */
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchKey]);
  return (
    <div className={styles.railCard}>
      <div className={styles.railCardHeader}>
        <span className={styles.railCardTitle}>Options</span>
        <span className={styles.railCardTitle}>{groups.length}</span>
      </div>
      {sortedGroups.length === 0 ? (
        <div className={styles.railCardSub}>None</div>
      ) : (
        <div className={`${styles.railScroll} scrollbar-slim`}>
          <div className={styles.railRowList}>
            {sortedGroups.map((g, i) => {
              const isFocus = g.underlying === searchedTicker.toUpperCase();
              const triggerIcon = g.triggers.pt50Hit
                ? "✓"
                : g.triggers.dteUnder21 || g.triggers.stopBreached
                  ? "⚠"
                  : "";
              const pct = g.pnlPctOfMax !== null ? `${(g.pnlPctOfMax * 100).toFixed(0)}%` : "—";
              return (
                <button
                  key={`opt-${g.underlying}-${g.expiry}-${i}`}
                  type="button"
                  onClick={() => onPickTicker(g.underlying)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    padding: isFocus ? "6px 8px" : "2px 0",
                    marginLeft: isFocus ? -8 : 0,
                    marginRight: isFocus ? -8 : 0,
                    borderRadius: 4,
                    background: isFocus ? "var(--surface-container-high)" : "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, color: "var(--on-surface)" }}>
                    <span style={{ fontWeight: 600 }}>{g.underlying} {GROUP_LABEL[g.kind]}{strikeRange(g) ? ` ${strikeRange(g)}` : ""}</span>
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      {triggerIcon && <span style={{ color: g.triggers.pt50Hit ? "var(--bullish)" : "var(--bearish)" }}>{triggerIcon}</span>}
                      <span className="tabular-nums" style={{ color: g.pnl >= 0 ? "var(--bullish)" : "var(--bearish)", fontWeight: 600 }}>{pct}</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 11, color: "var(--on-surface-variant)" }}>
                    <span className="tabular-nums">{shortExpiry(g.expiry)} · {g.dte}d</span>
                    <span className="tabular-nums" style={{ color: g.pnl >= 0 ? "var(--bullish)" : "var(--bearish)" }}>
                      {fmtSigned(g.pnl, g.legs[0]?.currency ?? "USD")}
                    </span>
                  </div>
                  {(() => {
                    const ll = levelsLine(g, snaps[g.underlying]);
                    if (!ll) return null;
                    const tagColor = ll.tone === "breached" ? "var(--bearish)" : ll.tone === "watch" ? "var(--neutral)" : "var(--on-surface-variant)";
                    return (
                      <div
                        title={LEVELS_TOOLTIP}
                        style={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", fontSize: 10.5, color: "var(--on-surface-variant)", cursor: "help" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, width: "100%" }}>
                          <span className="tabular-nums">EM {ll.emText}</span>
                          {ll.tag && (
                            <span className="tabular-nums" style={{ color: tagColor, whiteSpace: "nowrap" }}>⚠ {ll.tag}</span>
                          )}
                        </div>
                        {ll.levelText && <span className="tabular-nums">{ll.levelText}</span>}
                      </div>
                    );
                  })()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
