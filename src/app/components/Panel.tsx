"use client";

import type { ReactNode } from "react";
import styles from "../page.module.css";
import type {
  CommentSentimentResult,
  DigestResult,
  NewsItem,
  NewsResult,
  PanelDirection,
  PanelEvidence,
  PanelMeta,
  PanelSummary,
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

        {(evidence.length > 0 || showNewsFallback || showFeed) && <div className={styles.panelDivider} />}
        {evidence.length > 0 && <EvidenceList items={evidence} />}
        {evidence.length === 0 && showNewsFallback && <NewsList items={props.news!.items} />}
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
