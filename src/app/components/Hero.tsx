"use client";

import styles from "../page.module.css";
import type { DashboardData, TechnicalIndicators } from "../../lib/types";
import { fmtNum } from "./format";

export function Hero({ data }: { data: DashboardData }) {
  const snap = data.snapshot;
  const change = snap ? snap.lastPrice - snap.prevClose : 0;
  const changeCls = !snap || change === 0 ? styles.changeFlat : change > 0 ? styles.changeUp : styles.changeDown;
  const arrow = !snap || change === 0 ? "→" : change > 0 ? "↑" : "↓";
  const isHeld = data.heldPositions.length > 0;
  const ti = data.verdict?.technicalIndicators ?? null;
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
      {ti && <LevelsStrip ti={ti} />}
    </div>
  );
}

// Swing support/resistance + market structure, server-computed (see the
// /technical/indicators endpoint). Sits below the price as a compact, scannable
// strip — support emerald (price floor), resistance crimson (ceiling) — so the
// levels that drive credit-spread strike placement are visible at a glance.
// Renders nothing until the verdict (which carries the indicators) is ready.
function LevelsStrip({ ti }: { ti: TechnicalIndicators }) {
  const hasLevels = ti.support != null || ti.resistance != null;
  const hasStructure = ti.structureBias && ti.structureBias !== "n/a";
  if (!hasLevels && !hasStructure) return null;

  const extra = (levels: number[], primary: number | null) =>
    levels.filter((x) => x !== primary).slice(0, 2);
  const supExtra = extra(ti.supportLevels ?? [], ti.support);
  const resExtra = extra(ti.resistanceLevels ?? [], ti.resistance);

  const biasCls =
    ti.structureBias === "up" ? styles.changeUp
    : ti.structureBias === "down" ? styles.changeDown
    : styles.changeFlat;

  return (
    <div className={styles.heroLevels}>
      <div className={styles.levelGroup}>
        <span className="label-caps">Support</span>
        <span className={styles.levelVal + " " + styles.changeUp + " tabular-nums"}>
          {ti.support != null ? `$${fmtNum(ti.support)}` : "—"}
        </span>
        {supExtra.length > 0 && (
          <span className={styles.levelExtra + " tabular-nums"}>
            {supExtra.map((x) => `$${fmtNum(x)}`).join(" · ")}
          </span>
        )}
      </div>
      <div className={styles.levelGroup}>
        <span className="label-caps">Resistance</span>
        <span className={styles.levelVal + " " + styles.changeDown + " tabular-nums"}>
          {ti.resistance != null ? `$${fmtNum(ti.resistance)}` : "—"}
        </span>
        {resExtra.length > 0 && (
          <span className={styles.levelExtra + " tabular-nums"}>
            {resExtra.map((x) => `$${fmtNum(x)}`).join(" · ")}
          </span>
        )}
      </div>
      {hasStructure && (
        <div className={styles.levelGroup}>
          <span className="label-caps">Structure</span>
          <span className={styles.levelVal + " " + biasCls}>{ti.structureBias}</span>
          {ti.structureEvent && ti.structureEvent !== "none" && (
            <span className={styles.levelExtra + " tabular-nums"}>
              {ti.structureEvent} {ti.structureDirection}
              {ti.structureLevel != null ? ` · $${fmtNum(ti.structureLevel)}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
