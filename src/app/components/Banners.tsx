"use client";

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BTN = "h-[30px] px-3.5 text-xs font-semibold tracking-[0.04em]";

export function ErrorBanner({
  title,
  children,
  tone = "error",
}: {
  title: string;
  children?: ReactNode;
  tone?: "error" | "info";
}) {
  return (
    <Alert
      className={cn(
        "gap-y-1 rounded px-3.5 py-2.5 text-[12.5px]",
        tone === "error"
          ? "border-bearish bg-bearish-dim text-bearish"
          : "border-outline-variant bg-surface-container text-bearish",
      )}
    >
      <AlertTitle className="font-bold">{title}</AlertTitle>
      {children && (
        <AlertDescription className="gap-1 text-[12.5px] text-current">{children}</AlertDescription>
      )}
    </Alert>
  );
}

export function EarningsGate({
  ticker,
  daysAway,
  date,
  windowDays,
  onContinue,
  onCancel,
}: {
  ticker: string;
  daysAway: number | null;
  date: string | null;
  windowDays: number;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <Alert className="gap-y-2.5 rounded border-neutral bg-neutral-dim px-4 py-3.5 has-[>svg]:gap-x-2">
      <TriangleAlert className="text-neutral" />
      <AlertTitle className="text-[13px] font-semibold text-neutral">
        Earnings {daysAway === 0 ? "today" : `in ${daysAway} day${daysAway === 1 ? "" : "s"}`}
        {date ? ` (${date})` : ""} for {ticker}
      </AlertTitle>
      <AlertDescription className="gap-2.5 text-[12.5px] leading-normal text-on-surface-variant">
        <p>
          This print lands inside the {windowDays}-day expiry window. Per your conservative rule, a binary
          event in the window argues against opening new premium — so the AI panels haven&rsquo;t run yet.
          Continue the full analysis anyway?
        </p>
        <div className="flex gap-2">
          <Button type="button" className={BTN} onClick={onContinue}>
            Continue anyway
          </Button>
          <Button type="button" variant="outline" className={BTN} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
