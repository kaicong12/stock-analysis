"use client";

import { Badge } from "@/components/ui/badge";
import type { DashboardData, TechnicalIndicators } from "../../lib/types";
import { fmtNum } from "./format";

const TAG = "rounded border-outline-variant bg-surface-high px-2 py-0.5 text-[11px] font-medium tracking-[0.02em] text-on-surface-variant";

export function Hero({ data }: { data: DashboardData }) {
  const snap = data.snapshot;
  const change = snap ? snap.lastPrice - snap.prevClose : 0;
  const changeCls =
    !snap || change === 0 ? "text-on-surface-variant" : change > 0 ? "text-bullish" : "text-bearish";
  const arrow = !snap || change === 0 ? "→" : change > 0 ? "↑" : "↓";
  const ti = data.verdict?.technicalIndicators ?? null;
  return (
    <div className="flex flex-col gap-1.5 pt-1 pb-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-heading text-2xl leading-normal font-bold tracking-[0.02em]">{data.ticker}</span>
        {snap?.name && (
          <Badge variant="secondary" className={TAG}>
            {snap.name}
          </Badge>
        )}
        <Badge variant="secondary" className={TAG}>
          {data.symbol.split(".")[0]}
        </Badge>
      </div>
      {snap ? (
        <div className="flex items-baseline gap-3.5 tabular-nums">
          <span className="font-heading text-[44px] leading-normal font-semibold tracking-[-0.01em]">
            ${fmtNum(snap.lastPrice)}
          </span>
          <span className={`text-sm leading-normal font-semibold tabular-nums ${changeCls}`}>
            {arrow} {snap.changePct > 0 ? "+" : ""}
            {snap.changePct.toFixed(2)}% ({snap.changePct >= 0 ? "+" : ""}
            {fmtNum(change)})
          </span>
          <span className="label-caps">{snap.updateTime}</span>
        </div>
      ) : (
        <div className="flex items-baseline gap-3.5">
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
// levels that drive strike placement are visible at a glance. Renders nothing
// until the verdict (which carries the indicators) is ready.
function LevelsStrip({ ti }: { ti: TechnicalIndicators }) {
  const hasLevels = ti.support != null || ti.resistance != null;
  const hasStructure = ti.structureBias && ti.structureBias !== "n/a";
  if (!hasLevels && !hasStructure) return null;

  const extra = (levels: number[], primary: number | null) =>
    levels.filter((x) => x !== primary).slice(0, 2);
  const supExtra = extra(ti.supportLevels ?? [], ti.support);
  const resExtra = extra(ti.resistanceLevels ?? [], ti.resistance);

  const biasCls =
    ti.structureBias === "up"
      ? "text-bullish"
      : ti.structureBias === "down"
        ? "text-bearish"
        : "text-on-surface-variant";

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-outline-variant pt-2">
      <LevelGroup label="Support">
        <span className="text-sm leading-normal font-semibold tracking-[0.01em] text-bullish tabular-nums">
          {ti.support != null ? `$${fmtNum(ti.support)}` : "—"}
        </span>
        {supExtra.length > 0 && <LevelExtra>{supExtra.map((x) => `$${fmtNum(x)}`).join(" · ")}</LevelExtra>}
      </LevelGroup>
      <LevelGroup label="Resistance">
        <span className="text-sm leading-normal font-semibold tracking-[0.01em] text-bearish tabular-nums">
          {ti.resistance != null ? `$${fmtNum(ti.resistance)}` : "—"}
        </span>
        {resExtra.length > 0 && <LevelExtra>{resExtra.map((x) => `$${fmtNum(x)}`).join(" · ")}</LevelExtra>}
      </LevelGroup>
      {hasStructure && (
        <LevelGroup label="Structure">
          <span className={`text-sm leading-normal font-semibold tracking-[0.01em] ${biasCls}`}>{ti.structureBias}</span>
          {ti.structureEvent && ti.structureEvent !== "none" && (
            <LevelExtra>
              {ti.structureEvent} {ti.structureDirection}
              {ti.structureLevel != null ? ` · $${fmtNum(ti.structureLevel)}` : ""}
            </LevelExtra>
          )}
        </LevelGroup>
      )}
    </div>
  );
}

function LevelGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="label-caps">{label}</span>
      {children}
    </div>
  );
}

function LevelExtra({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium text-on-surface-variant tabular-nums">{children}</span>;
}
