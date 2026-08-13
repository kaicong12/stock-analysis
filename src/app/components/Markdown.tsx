// Markdown renderers for model-written prose, block and inline.

"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

const BLOCK_ELEMENTS = ["p", "h1", "h2", "h3", "h4", "h5", "h6"];

/** Renders a markdown block with GFM enabled. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={styles.markdown + (className ? " " + className : "")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

// Drops the bullet prefix a single-line value inherited from its prompt exemplar.
function stripLeadingBullet(text: string): string {
  return text.includes("\n") ? text : text.replace(/^\s*[-*+]\s+/, "");
}

/** Renders markdown as a phrase, unwrapping block marks so a stray "##" stays text. */
export function MarkdownInline({ children }: { children: string }) {
  return (
    <span className={styles.markdownInline}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={BLOCK_ELEMENTS}
        unwrapDisallowed
      >
        {stripLeadingBullet(children)}
      </ReactMarkdown>
    </span>
  );
}
