"use client";

import type { ReactNode } from "react";
import { Activity, CalendarClock, Siren, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DigestSectionKey, MarketDigestResult, TapeQuote } from "@/lib/digest/types";
import { relTime } from "./format";

const SECTION_LABELS: Record<DigestSectionKey, string> = {
  movers: "What moved the tape",
  vol: "Vol & premium",
  runway: "Event runway",
  risk: "Headline risk",
};

const SECTION_ICONS: Record<DigestSectionKey, ReactNode> = {
  movers: <TrendingUp />,
  vol: <Activity />,
  runway: <CalendarClock />,
  risk: <Siren />,
};

const SUB_LABEL =
  "text-[9.5px] font-bold tracking-[0.08em] uppercase text-on-surface-variant";

function toneFor(pct: number | null): string {
  if (pct === null || pct === 0) return "text-neutral";
  return pct > 0 ? "text-bullish" : "text-bearish";
}

function TapeCell({ quote }: { quote: TapeQuote }) {
  const { last, changePct } = quote;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded border border-outline-variant bg-surface-low px-3 py-2">
      <span className={cn(SUB_LABEL, "truncate")}>{quote.label}</span>
      <span className="text-[13px] font-semibold tabular-nums text-on-surface">
        {last === null ? "—" : last.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </span>
      <span className={cn("text-[11px] font-medium tabular-nums", toneFor(changePct))}>
        {changePct === null ? "—" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`}
      </span>
    </div>
  );
}

export function MarketDigest(props: {
  digest: MarketDigestResult | null;
  status: "idle" | "loading" | "ready" | "error";
}) {
  const { digest, status } = props;
  const vix = digest?.tape?.vix ?? null;

  return (
    <Card className="gap-3.5 border-outline-variant px-6 py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-heading text-[13px] font-semibold tracking-[0.06em] uppercase text-on-surface">
          Market Digest
        </span>
        <Badge className="rounded-[3px] border-tertiary/25 bg-tertiary/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase text-tertiary">
          Market-wide
        </Badge>
        {digest?.asOf && (
          <span className="text-[11px] tabular-nums text-on-surface-variant">
            tape as of {digest.asOf}
          </span>
        )}
      </div>

      {status === "loading" && (
        <div className="flex flex-col gap-2.5 py-1">
          <Skeleton className="h-3 w-[80%]" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-3 w-[65%]" />
          <Skeleton className="h-3 w-[74%]" />
        </div>
      )}

      {status === "error" && (
        <p className="text-xs leading-normal italic text-on-surface-variant">
          Market digest unavailable — the news feed or the sidecar did not respond. Nothing is
          cached, so a reload will retry.
        </p>
      )}

      {status === "ready" && digest && (
        <>
          {digest.topLine && (
            <p className="text-[13px] leading-[1.55] font-medium text-on-surface">
              {digest.topLine}
            </p>
          )}

          {digest.tape && digest.tape.quotes.length > 0 && (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(112px,1fr))]">
              {digest.tape.quotes.map((q) => (
                <TapeCell key={q.key} quote={q} />
              ))}
            </div>
          )}

          {vix && (
            <p className="text-[11px] tabular-nums text-on-surface-variant">
              {vix.pct === null
                ? `VIX ${vix.last} — percentile unavailable (${vix.barsRanked} sessions available)`
                : `VIX ${vix.last} — ${vix.pct}th percentile of the last ${vix.barsRanked} sessions (range ${vix.low}–${vix.high})`}
            </p>
          )}

          <Separator className="bg-outline-variant" />

          <div className="flex flex-col gap-4">
            {digest.sections.map((s) => (
              <div key={s.key} className="flex flex-col gap-1.5">
                <div className="inline-flex items-center gap-2 font-heading text-[12px] font-semibold tracking-[0.04em] uppercase text-on-surface [&_svg]:size-3.5 [&_svg]:text-tertiary">
                  {SECTION_ICONS[s.key]}
                  {SECTION_LABELS[s.key]}
                </div>

                <p
                  className={cn(
                    "text-[12.5px] leading-[1.55]",
                    s.status === "unavailable"
                      ? "italic text-on-surface-variant"
                      : "text-on-surface",
                  )}
                >
                  {s.headline}
                </p>

                {s.bullets.length > 0 && (
                  <ul className="flex flex-col gap-1 pl-4">
                    {s.bullets.map((b, i) => (
                      <li
                        key={i}
                        className="list-disc text-[12.5px] leading-[1.55] text-on-surface-variant marker:text-primary"
                      >
                        {b}
                      </li>
                    ))}
                  </ul>
                )}

                {s.citations.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                    {s.citations.map((c) => (
                      <a
                        key={c.url}
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-tertiary underline decoration-outline-variant underline-offset-2 hover:decoration-tertiary"
                      >
                        {c.title.length > 72 ? `${c.title.slice(0, 72)}…` : c.title}
                        <span className="ml-1 tabular-nums text-on-surface-variant">
                          {relTime(Math.floor(new Date(c.publishedAt).getTime() / 1000))}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {digest.scoutKeywords.length > 0 && (
            <p className={cn(SUB_LABEL, "pt-0.5")}>
              Scout beats: {digest.scoutKeywords.join(" · ")}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
