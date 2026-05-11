"use client";

import styles from "../page.module.css";
import type { DashboardData } from "../../lib/types";
import { fmtNum } from "./format";

export function Hero({ data }: { data: DashboardData }) {
  const snap = data.snapshot;
  const change = snap ? snap.lastPrice - snap.prevClose : 0;
  const changeCls = !snap || change === 0 ? styles.changeFlat : change > 0 ? styles.changeUp : styles.changeDown;
  const arrow = !snap || change === 0 ? "→" : change > 0 ? "↑" : "↓";
  const isHeld = data.heldPositions.length > 0;
  return (
    <div className={styles.hero}>
      <div className={styles.heroTickerRow}>
        <span className={styles.heroTicker + " font-display"}>{data.ticker}</span>
        {snap?.name && <span className={styles.tag}>{snap.name}</span>}
        <span className={styles.tag}>{data.symbol.split(".")[0]}</span>
        {isHeld ? <span className={styles.heldChip}>● Held</span> : <span className={styles.unheldChip}>Watching</span>}
      </div>
      {snap ? (
        <div className={styles.heroPriceRow}>
          <span className={styles.heroPrice + " font-display"}>${fmtNum(snap.lastPrice)}</span>
          <span className={styles.heroChange + " " + changeCls + " tabular-nums"}>
            {arrow} {snap.changePct > 0 ? "+" : ""}{snap.changePct.toFixed(2)}% ({snap.changePct >= 0 ? "+" : ""}{fmtNum(change)})
          </span>
          <span className="label-caps">{snap.updateTime}</span>
        </div>
      ) : (
        <div className={styles.heroPriceRow}>
          <span className="label-caps">No live snapshot — OpenD may be unreachable.</span>
        </div>
      )}
    </div>
  );
}
