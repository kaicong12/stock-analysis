"use client";

import type { ReactNode } from "react";
import styles from "../page.module.css";
import type {
  CommentSentimentResult,
  DigestResult,
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
  derivatives: "Derivatives Breakdown",
  news: "News Flow",
  digest: "Stock Digest",
  sentiment: "Community Sentiment",
  fundamentals: "Fundamentals",
  insider: "Insider Flow",
};

export function Panel(props: {
  title: string;
  icon: ReactNode;
  summary?: PanelSummary;
  raw?: string;
  fallback?: string;
  news?: NewsResult | DigestResult | null;
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
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle + " font-display"}>
          {props.icon}
          {props.title}
        </div>
        {summary?.direction && <DirectionChip direction={summary.direction} />}
      </div>

      <div className={styles.panelBody + " scrollbar-slim"}>
        {summary ? (
          <>
            <div className={styles.panelHeadline}>{summary.headline}</div>
            {summary.conclusion && <p className={styles.panelConclusion}>{summary.conclusion}</p>}
            {summary.bullets.length > 0 && (
              <ul className={styles.panelBullets}>
                {summary.bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
            {meta.length > 0 && <MetaRow meta={meta} />}
          </>
        ) : (
          <div className={styles.panelHeadline} style={{ color: "var(--on-surface-variant)" }}>
            {props.fallback ?? "No synthesis available."}
          </div>
        )}

        {(evidence.length > 0 || showNewsFallback || showFeed || readThrough.length > 0 || insiderFlow.length > 0) && (
          <div className={styles.panelDivider} />
        )}
        {evidence.length > 0 && <EvidenceList items={evidence} />}
        {evidence.length === 0 && showNewsFallback && <NewsList items={props.news!.items} />}
        {readThrough.length > 0 && <ReadThroughBlock items={readThrough} />}
        {insiderFlow.length > 0 && <InsiderFlowBlock items={insiderFlow} />}
        {showFeed && <FeedList posts={props.feed!.posts} />}
      </div>
    </section>
  );
}

const DIRECTION_CLS: Record<PanelDirection, string> = {
  bullish: "dirBullish",
  bearish: "dirBearish",
  neutral: "dirNeutral",
  mixed: "dirMixed",
  "n/a": "dirNa",
};

function DirectionChip({ direction }: { direction: PanelDirection }) {
  const label = direction === "n/a" ? "No data" : direction.charAt(0).toUpperCase() + direction.slice(1);
  return <span className={styles.directionChip + " " + styles[DIRECTION_CLS[direction]]}>{label}</span>;
}

function MetaRow({ meta }: { meta: PanelMeta[] }) {
  return (
    <div className={styles.metaRow}>
      {meta.map((m) => (
        <span key={m.label} className={styles.metaItem}>
          <span className={styles.metaLabel}>{m.label}</span>
          <span className={styles.metaValue}>{m.value}</span>
        </span>
      ))}
    </div>
  );
}

function EvidenceList({ items }: { items: PanelEvidence[] }) {
  return (
    <div className={styles.evidenceList}>
      {items.slice(0, 5).map((item, i) => (
        <a
          key={i}
          className={styles.evidenceItem}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className={styles.evidenceIndex}>{String(i + 1).padStart(2, "0")}</span>
          <span className={styles.evidenceTitle}>{item.title}</span>
        </a>
      ))}
    </div>
  );
}

const RT_DIR_CLS: Record<ReadThrough["direction"], string> = {
  bullish: "rtBullish",
  bearish: "rtBearish",
  neutral: "rtNeutral",
};

// Peer read-through: sector-peer news with a read-through direction FOR this
// ticker. Deliberately rendered apart from the self-news evidence so peer
// headlines are never mistaken for the ticker's own news.
function ReadThroughBlock({ items }: { items: ReadThrough[] }) {
  return (
    <div>
      <div className={styles.readThroughLabel}>Sector read-through</div>
      <div className={styles.readThroughList}>
        {items.slice(0, 5).map((it, i) => (
          <a
            key={i}
            className={styles.readThroughItem + " " + styles[RT_DIR_CLS[it.direction]]}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className={styles.readThroughHead}>
              <span className={styles.readThroughDot} />
              <span className={styles.readThroughPeer}>{it.peer}</span>
              <span className={styles.readThroughClass}>{it.classification.replace("-", " ")}</span>
            </div>
            <span className={styles.readThroughNote}>{it.note}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

const INSIDER_DIR_CLS: Record<InsiderFlowItem["direction"], string> = {
  buy: "rtBullish",
  sell: "rtBearish",
  neutral: "rtNeutral",
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
      <div className={styles.readThroughLabel}>Recent Form 4 transactions</div>
      <div className={styles.readThroughList}>
        {items.slice(0, 8).map((it, i) => {
          const pct = it.pctOfHoldings !== null && it.pctOfHoldings > 0
            ? ` · ${(it.pctOfHoldings * 100).toFixed(1)}% of stake`
            : "";
          return (
            <div key={i} className={styles.readThroughItem + " " + styles[INSIDER_DIR_CLS[it.direction]]}>
              <div className={styles.readThroughHead}>
                <span className={styles.readThroughDot} />
                <span className={styles.readThroughPeer}>{it.name}</span>
                {it.routine && <span className={styles.insiderRoutineTag}>routine</span>}
                <span className={styles.readThroughClass}>{it.typeLabel}</span>
              </div>
              <span className={styles.readThroughNote}>
                {it.title} · {it.shares.toLocaleString()} sh · {insiderMoney(it.value)}
                {pct}{it.date ? ` · ${it.date}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewsList({ items }: { items: NewsItem[] }) {
  return (
    <div className={styles.newsList}>
      {items.slice(0, 8).map((item) => (
        <a key={item.id} className={styles.newsItem} href={item.url} target="_blank" rel="noopener noreferrer">
          <span className={styles.newsTitle}>{item.title}</span>
          <span className={styles.newsMeta}>{relTime(item.publishTime)}</span>
        </a>
      ))}
    </div>
  );
}

function FeedList({ posts }: { posts: CommentSentimentResult["posts"] }) {
  return (
    <div className={styles.newsList}>
      {posts.slice(0, 8).map((p) => {
        const href = p.url && p.url.length > 0 ? p.url : `https://www.moomoo.com/community/feed/${p.id}`;
        return (
          <a key={p.id} className={styles.newsItem} href={href} target="_blank" rel="noopener noreferrer">
            <span className={styles.newsTitle}>{p.title || p.desc?.slice(0, 140) || "(no title)"}</span>
            <span className={styles.newsMeta}>{relTime(p.publishTime)}</span>
          </a>
        );
      })}
    </div>
  );
}
