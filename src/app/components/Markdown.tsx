"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

const BLOCK_ELEMENTS = ["p", "h1", "h2", "h3", "h4", "h5", "h6"];

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={styles.markdown + (className ? " " + className : "")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

// The panel prompts hand the model a "- " prefixed exemplar, so single-line
// fields often carry that prefix; inside the host <li> it would draw a second
// bullet. Multi-line values keep it — there the list is real.
function stripLeadingBullet(text: string): string {
  return text.includes("\n") ? text : text.replace(/^\s*[-*+]\s+/, "");
}

// For a phrase inside an element that already sets the layout: block marks are
// unwrapped so a stray "##" renders as text rather than a heading.
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
