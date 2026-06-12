"use client";

import styles from "./MacroBriefing.module.css";

interface Props {
  text: string | null;
  status: "idle" | "loading" | "ready" | "error";
}

// Minimal inline markdown → React: handles **bold**, *italic*,
// section headers (lines starting with **...**:), and bullet lines (* / - ).
function renderLine(line: string, key: number) {
  // Blank line
  if (!line.trim()) return <div key={key} className={styles.spacer} />;

  // Section header: line is entirely **text** (optional colon)
  const headerMatch = /^\*\*(.+?)\*\*:?$/.exec(line.trim());
  if (headerMatch) {
    return (
      <div key={key} className={styles.sectionHeader}>
        {headerMatch[1].replace(/:$/, "")}
      </div>
    );
  }

  // Bullet line
  const bulletMatch = /^[*\-]\s+(.+)/.exec(line.trim());
  const content = bulletMatch ? bulletMatch[1] : line;

  // Inline bold/italic
  const parts = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });

  if (bulletMatch) {
    return (
      <div key={key} className={styles.bullet}>
        <span className={styles.bulletDot} />
        <span>{parts}</span>
      </div>
    );
  }
  return <div key={key} className={styles.line}>{parts}</div>;
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

      {status === "ready" && text && (
        <div className={styles.body}>
          {text.split("\n").map((line, i) => renderLine(line, i))}
        </div>
      )}
    </div>
  );
}
