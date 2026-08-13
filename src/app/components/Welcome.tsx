// Idle-state copy and the loading skeleton for the main column.

"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Renders the what-this-does card shown before the first search. */
export function Welcome() {
  return (
    <Card className="gap-2 border-outline-variant p-7">
      <h2 className="font-heading text-lg leading-normal font-semibold text-on-surface">
        Synthesis-grade analysis, on demand.
      </h2>
      <p className="text-[13.5px] leading-[1.6] text-on-surface-variant">
        Type a ticker and press{" "}
        <kbd className="mx-0.5 inline-block rounded-sm border border-outline-variant bg-surface-high px-1.5 py-px font-sans text-[11px] font-semibold text-on-surface">
          ↵
        </kbd>
        . We&rsquo;ll pull capital flow, technical indicators, options activity, news flow, and community
        sentiment from moomoo, layer on server-computed price action and volatility, and have Gemini issue
        a dual-sleeve verdict.
      </p>
      <p className="text-xs leading-[1.6] text-on-surface-variant">
        Examples: <code>GOOGL</code>, <code>AAPL</code>, <code>HK.00700</code>, <code>NVDA</code>. Bare
        tickers default to US.
      </p>
    </Card>
  );
}

/** Renders placeholder blocks standing in for the hero and panel grid. */
export function SkeletonBlock() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[200px]" />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(420px,1fr))]">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[220px]" />
        ))}
      </div>
    </div>
  );
}
