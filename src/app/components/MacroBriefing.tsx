"use client";

import { Markdown } from "./Markdown";
import styles from "./MacroBriefing.module.css";

interface Props {
  text: string | null;
  status: "idle" | "loading" | "ready" | "error";
}

export function MacroBriefing({ text, status }: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.label}>Macro Environment</span>
        <span className={styles.badge}>Live · Google Search</span>
      </div>

      {status === "loading" && (
        <div className={styles.skeleton}>
          <div className={styles.skeletonLine} style={{ width: "72%" }} />
          <div className={styles.skeletonLine} style={{ width: "88%" }} />
          <div className={styles.skeletonLine} style={{ width: "60%" }} />
          <div className={styles.skeletonLine} style={{ width: "80%" }} />
        </div>
      )}

      {status === "error" && (
        <p className={styles.error}>Macro briefing unavailable — Google Search grounding failed.</p>
      )}

      {status === "ready" && text && <Markdown className={styles.body}>{text}</Markdown>}
    </div>
  );
}
