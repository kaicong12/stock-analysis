"use client";

import type { ReactNode } from "react";
import {
  Banknote,
  ChartLine,
  FileText,
  Heart,
  Landmark,
  Newspaper,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Markdown, MarkdownInline } from "./Markdown";
import type {
  CommentSentimentResult,
  InsiderFlowItem,
  NewsItem,
  NewsResult,
  PanelDirection,
  PanelEvidence,
  PanelMeta,
  PanelSummary,
  ReadThrough,
  Verdict,
} from "../../lib/types";
import { relTime } from "./format";

export const PANEL_LABELS: Record<keyof Verdict["panels"], string> = {
  capital: "Capital Anomaly",
  technical: "Technical Anomaly",
  news: "News Flow",
  digest: "Stock Digest",
  sentiment: "Community Sentiment",
  fundamentals: "Fundamentals",
  insider: "Insider Flow",
};

export const PANEL_ICONS: Record<keyof Verdict["panels"], ReactNode> = {
  capital: <Banknote />,
  technical: <ChartLine />,
  news: <Newspaper />,
  digest: <FileText />,
  sentiment: <Heart />,
  fundamentals: <Landmark />,
  insider: <UserCheck />,
};

const SUB_LABEL = "mb-1.5 text-[9.5px] font-bold tracking-[0.08em] uppercase text-on-surface-variant";
const TILE = "rounded border border-outline-variant bg-surface-low";

export function Panel(props: {
  title: string;
  icon: ReactNode;
  summary?: PanelSummary;
  raw?: string;
  fallback?: string;
  news?: NewsResult | null;
  feed?: CommentSentimentResult | null;
}) {
  const summary = props.summary;
  const evidence = summary?.evidence ?? [];
  const meta = summary?.meta ?? [];
  const readThrough = summary?.readThrough ?? [];
  const insiderFlow = summary?.insiderFlow ?? [];
  const showFeed = !!props.feed && props.feed.posts.length > 0;
  const showNewsFallback = !summary?.evidence && !!props.news && props.news.items.length > 0;
  return (
    <Card className="h-[560px] gap-3 overflow-hidden border-outline-variant p-[18px] pb-4">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 font-heading text-[15px] font-semibold text-on-surface [&_svg]:size-3.5 [&_svg]:text-tertiary">
          {props.icon}
          {props.title}
        </div>
        {summary?.direction && <DirectionChip direction={summary.direction} />}
      </div>

      <div className="scrollbar-slim -mr-1.5 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1.5">
        {summary ? (
          summary.prose ? (
            <Markdown className="text-[12.5px] leading-[1.6] text-on-surface-variant">
              {summary.prose}
            </Markdown>
          ) : (
            <>
              <div className="text-[13.5px] leading-[1.55] text-on-surface">
                <MarkdownInline>{summary.headline}</MarkdownInline>
              </div>
              {summary.conclusion && (
                <p className="text-[12.5px] leading-[1.55] italic text-on-surface-variant">
                  <MarkdownInline>{summary.conclusion}</MarkdownInline>
                </p>
              )}
              {summary.bullets.length > 0 && (
                <ul className="flex list-none flex-col gap-1.5">
                  {summary.bullets.map((b, i) => (
                    <li
                      key={i}
                      className="relative pl-3.5 text-[12.5px] leading-[1.55] text-on-surface-variant before:absolute before:top-2 before:left-0 before:size-1 before:rounded-full before:bg-tertiary"
                    >
                      <MarkdownInline>{b}</MarkdownInline>
                    </li>
                  ))}
                </ul>
              )}
              {meta.length > 0 && <MetaRow meta={meta} />}
            </>
          )
        ) : (
          <div className="text-[13.5px] leading-[1.55] text-on-surface-variant">
            {props.fallback ?? "No synthesis available."}
          </div>
        )}

        {(evidence.length > 0 || showNewsFallback || showFeed || readThrough.length > 0 || insiderFlow.length > 0) && (
          <Separator className="mt-1 -mx-[18px] w-[calc(100%+36px)]!" />
        )}
        {evidence.length > 0 && <EvidenceList items={evidence} />}
        {evidence.length === 0 && showNewsFallback && <NewsList items={props.news!.items} />}
        {readThrough.length > 0 && <ReadThroughBlock items={readThrough} />}
        {insiderFlow.length > 0 && <InsiderFlowBlock items={insiderFlow} />}
        {showFeed && <FeedList posts={props.feed!.posts} />}
      </div>
    </Card>
  );
}

const DIRECTION_CLS: Record<PanelDirection, string> = {
  bullish: "border-bullish/35 bg-bullish-dim text-bullish",
  bearish: "border-bearish/35 bg-bearish-dim text-bearish",
  neutral: "border-neutral/35 bg-neutral-dim text-neutral",
  mixed: "border-outline-variant bg-surface-high text-on-surface",
  "n/a": "border-outline-variant bg-surface-low text-on-surface-variant",
};

function DirectionChip({ direction }: { direction: PanelDirection }) {
  const label = direction === "n/a" ? "No data" : direction.charAt(0).toUpperCase() + direction.slice(1);
  return (
    <Badge
      className={cn(
        "gap-1.5 border px-2.5 py-[3px] text-[10.5px] font-bold tracking-[0.06em] uppercase",
        DIRECTION_CLS[direction],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}

function MetaRow({ meta }: { meta: PanelMeta[] }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {meta.map((m) => (
        <span key={m.label} className={cn("inline-flex min-w-16 flex-col gap-px px-2.5 py-1.5", TILE)}>
          <span className="text-[9.5px] font-bold tracking-[0.08em] uppercase text-on-surface-variant">
            {m.label}
          </span>
          <span className="text-[13px] font-semibold text-on-surface tabular-nums">{m.value}</span>
        </span>
      ))}
    </div>
  );
}

function EvidenceList({ items }: { items: PanelEvidence[] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.slice(0, 5).map((item, i) => (
        <a
          key={i}
          className={cn(
            "flex items-start gap-2 px-2.5 py-[7px] text-on-surface no-underline transition-colors hover:border-tertiary hover:bg-surface-high",
            TILE,
          )}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="shrink-0 pt-0.5 text-[10.5px] font-bold tracking-[0.04em] text-tertiary tabular-nums">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="text-[12.5px] leading-[1.45] text-on-surface">{item.title}</span>
        </a>
      ))}
    </div>
  );
}

const RT_DIR_CLS: Record<ReadThrough["direction"], string> = {
  bullish: "text-bullish",
  bearish: "text-bearish",
  neutral: "text-neutral",
};

// Peer read-through: sector-peer news with a read-through direction FOR this
// ticker. Deliberately rendered apart from the self-news evidence so peer
// headlines are never mistaken for the ticker's own news.
function ReadThroughBlock({ items }: { items: ReadThrough[] }) {
  return (
    <div>
      <div className={SUB_LABEL}>Sector read-through</div>
      <div className="flex flex-col gap-2">
        {items.slice(0, 5).map((it, i) => (
          <a
            key={i}
            className={cn(RT_ITEM, RT_DIR_CLS[it.direction])}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <RowHead peer={it.peer} tag={it.classification.replace("-", " ")} />
            <span className="text-xs leading-[1.45] text-on-surface-variant">{it.note}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

const RT_ITEM =
  "flex flex-col gap-1 rounded border border-outline-variant border-l-2 border-l-current bg-surface-low px-2.5 py-[7px] no-underline transition-colors hover:bg-surface-high";

function RowHead({ peer, tag, routine }: { peer: string; tag: string; routine?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-[7px] shrink-0 rounded-full bg-current" />
      <span className="text-[11px] font-bold tracking-[0.04em] text-on-surface tabular-nums">{peer}</span>
      {routine && (
        <span className="rounded border border-outline-variant bg-surface-high px-[5px] py-px text-[8.5px] font-bold tracking-[0.06em] uppercase text-on-surface-variant">
          routine
        </span>
      )}
      <span className="ml-auto text-[9.5px] font-semibold tracking-[0.06em] uppercase text-on-surface-variant">
        {tag}
      </span>
    </div>
  );
}

const INSIDER_DIR_CLS: Record<InsiderFlowItem["direction"], string> = {
  buy: "text-bullish",
  sell: "text-bearish",
  neutral: "text-neutral",
};

function insiderMoney(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(a / 1_000)}K`;
  if (a > 0) return `$${Math.round(a)}`;
  return "—";
}

// Insider transaction sub-block. Discretionary open-market buys/sells get a
// green/red left border (the conviction trades); routine 10b5-1 plan sells and
// comp plumbing (grants/exercises/tax) render neutral grey with a "routine" tag,
// so a large-cap's wall of pre-scheduled selling never reads as red conviction.
function InsiderFlowBlock({ items }: { items: InsiderFlowItem[] }) {
  return (
    <div>
      <div className={SUB_LABEL}>Recent Form 4 transactions</div>
      <div className="flex flex-col gap-2">
        {items.slice(0, 8).map((it, i) => {
          const pct =
            it.pctOfHoldings !== null && it.pctOfHoldings > 0
              ? ` · ${(it.pctOfHoldings * 100).toFixed(1)}% of stake`
              : "";
          return (
            <div key={i} className={cn(RT_ITEM, INSIDER_DIR_CLS[it.direction])}>
              <RowHead peer={it.name} tag={it.typeLabel} routine={it.routine} />
              <span className="text-xs leading-[1.45] text-on-surface-variant">
                {it.title} · {it.shares.toLocaleString()} sh · {insiderMoney(it.value)}
                {pct}
                {it.date ? ` · ${it.date}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const NEWS_ITEM = "flex flex-col gap-0.5 rounded px-2.5 py-2 transition-colors hover:bg-surface-high";

function NewsList({ items }: { items: NewsItem[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.slice(0, 8).map((item) => (
        <a key={item.id} className={NEWS_ITEM} href={item.url} target="_blank" rel="noopener noreferrer">
          <span className="text-[13px] leading-[1.4] font-medium text-on-surface">{item.title}</span>
          <span className="text-[11px] text-on-surface-variant tabular-nums">{relTime(item.publishTime)}</span>
        </a>
      ))}
    </div>
  );
}

function FeedList({ posts }: { posts: CommentSentimentResult["posts"] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {posts.slice(0, 8).map((p) => {
        const href = p.url && p.url.length > 0 ? p.url : `https://www.moomoo.com/community/feed/${p.id}`;
        return (
          <a key={p.id} className={NEWS_ITEM} href={href} target="_blank" rel="noopener noreferrer">
            <span className="text-[13px] leading-[1.4] font-medium text-on-surface">
              {p.title || p.desc?.slice(0, 140) || "(no title)"}
            </span>
            <span className="text-[11px] text-on-surface-variant tabular-nums">{relTime(p.publishTime)}</span>
          </a>
        );
      })}
    </div>
  );
}
