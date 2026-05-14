"use client";

import styles from "../page.module.css";
import type { HeldGroup, Portfolio } from "../../lib/types";
import { isOptionGroup } from "../../lib/positions/types";
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
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
