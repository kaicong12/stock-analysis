"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import styles from "./AskAI.module.css";
import { streamAssistant, type ChatMessage } from "../../lib/gemini/assistant";
import { IconCloseX } from "./icons";

type Citation = { title: string; uri: string };

interface AssistantMessage extends ChatMessage {
  citations?: Citation[];
  // Distinguishes a streaming/in-flight assistant turn so we can render a cursor.
  streaming?: boolean;
  errored?: boolean;
}

const SUGGESTIONS = [
  "Why is {TICKER} moving today?",
  "Summarize the bull vs bear case",
  "What's the IV regime telling me?",
  "How should I position into earnings?",
  "What are analysts saying recently?",
  "Any risks the panels disagree on?",
];

interface AskAIProps {
  ticker: string;
  mode: "inline" | "drawer";
  isOpen?: boolean;
  onClose?: () => void;
}

export function AskAI({ ticker, mode, isOpen = true, onClose }: AskAIProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const tickerLabel = useMemo(() => ticker.trim().toUpperCase() || "—", [ticker]);

  // Reset history when the user switches tickers — the assistant is grounded
  // per-ticker so a stale chat would be misleading.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput("");
    setStreaming(false);
  }, [tickerLabel]);

  // Autoscroll on new content.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Focus the input when the drawer opens, so users can start typing immediately.
  useEffect(() => {
    if (mode === "drawer" && isOpen) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [mode, isOpen]);

  const sendQuestion = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || streaming || tickerLabel === "—") return;

      const userMsg: AssistantMessage = { role: "user", content: q };
      const placeholder: AssistantMessage = { role: "assistant", content: "", streaming: true };

      setMessages((prev) => [...prev, userMsg, placeholder]);
      setInput("");
      setStreaming(true);

      const history: ChatMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: q },
      ];

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        let acc = "";
        let citations: Citation[] | undefined;
        let errored = false;

        for await (const evt of streamAssistant({
          ticker: tickerLabel,
          messages: history,
          signal: ctrl.signal,
        })) {
          if (evt.type === "text") {
            acc += evt.delta;
            setMessages((prev) => {
              const next = prev.slice();
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: acc };
              }
              return next;
            });
          } else if (evt.type === "citations") {
            citations = evt.citations;
          } else if (evt.type === "error") {
            errored = true;
            acc = acc || `Error: ${evt.message}`;
            setMessages((prev) => {
              const next = prev.slice();
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: acc, errored: true };
              }
              return next;
            });
          } else if (evt.type === "done") {
            // handled below
          }
        }

        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              streaming: false,
              citations,
              errored: errored || last.errored,
            };
          }
          return next;
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                content: last.content || `Error: ${(err as Error).message}`,
                errored: true,
              };
            }
            return next;
          });
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setStreaming(false);
      }
    },
    [messages, streaming, tickerLabel],
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void sendQuestion(input);
    },
    [input, sendQuestion],
  );

  const onSuggestionClick = useCallback(
    (template: string) => {
      const filled = template.replace(/\{TICKER\}/g, tickerLabel);
      void sendQuestion(filled);
    },
    [sendQuestion, tickerLabel],
  );

  const showSuggestions = messages.length === 0;

  const panel = (
    <section className={styles.panel} aria-label="Ask AI">
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.avatar}>G</div>
          <div>
            <div className={styles.headerTitle}>Research Assistant</div>
            <div className={styles.headerSub}>grounded on {tickerLabel} analysis</div>
          </div>
        </div>
        {mode === "drawer" && (
          <button
            type="button"
            className={styles.headerClose}
            onClick={onClose}
            aria-label="Close"
          >
            <IconCloseX />
          </button>
        )}
      </header>

      <div className={styles.body} ref={bodyRef}>
        <div className={styles.intro}>
          <span className={styles.introLabel}>Assistant</span>
          <p className={styles.introBody}>
            Ask me anything about <strong>{tickerLabel}</strong>. I pull live data
            via Google Search, so I can confirm prices, news, and analyst moves —
            useful when the panel consensus is unclear or conflicting.
          </p>
        </div>

        {showSuggestions && (
          <div className={styles.tryAsking}>
            <span className={styles.tryAskingLabel}>Try asking</span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.suggestion}
                onClick={() => onSuggestionClick(s)}
                disabled={streaming || tickerLabel === "—"}
              >
                <span className={styles.suggestionMark}>›</span>
                <span>{s.replace(/\{TICKER\}/g, tickerLabel)}</span>
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className={styles.message}>
                <div
                  className={`${styles.messageBubble} ${styles.messageUser}`}
                >
                  {m.content}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className={styles.message}>
              <span className={styles.messageLabel}>Assistant</span>
              <div
                className={`${styles.messageBubble} ${styles.messageAssistant} ${
                  m.errored ? styles.messageError : ""
                }`}
              >
                {m.content || (m.streaming ? "" : " ")}
                {m.streaming && <span className={styles.cursor} aria-hidden />}
              </div>
              {m.citations && m.citations.length > 0 && (
                <div className={styles.citations}>
                  <span className={styles.citationsLabel}>
                    Sources · {m.citations.length}
                  </span>
                  {m.citations.map((c, ci) => (
                    <a
                      key={ci}
                      className={styles.citationLink}
                      href={c.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.title}
                    >
                      {c.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <form className={styles.inputForm} onSubmit={onSubmit}>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder={`Ask about ${tickerLabel}…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming || tickerLabel === "—"}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!input.trim() || streaming || tickerLabel === "—"}
            aria-label="Send"
          >
            ↑
          </button>
        </form>
        <div className={styles.footerMeta}>
          <span className={styles.footerMetaDot} />
          <span>Powered by Google Search grounding</span>
        </div>
      </footer>
    </section>
  );

  if (mode === "drawer") {
    return (
      <>
        <div
          className={`${styles.drawerOverlay} ${isOpen ? styles.drawerOverlayOpen : ""}`}
          onClick={onClose}
          aria-hidden
        />
        <div
          className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Ask AI"
        >
          {panel}
        </div>
      </>
    );
  }

  return panel;
}
