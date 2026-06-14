"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import styles from "./page.module.css";
import type {
  HeldGroup,
  PanelSummary,
  Portfolio,
  Position,
  SnapshotResult,
  Verdict,
} from "../lib/types";
import { classifyPortfolio } from "../lib/positions/groups";
import { annotateGroups } from "../lib/positions/triggers";
import { loadBatchResult, saveBatchSession, type BatchTickerPayload } from "../lib/batch/cache";
import { AskAI } from "./components/AskAI";
import { BatchView } from "./components/BatchView";
import { Hero } from "./components/Hero";
import { HeldOptionsDetail } from "./components/HeldOptionsDetail";
import { LeftRail } from "./components/LeftRail";
import { MacroBriefing } from "./components/MacroBriefing";
import { Panel, PANEL_LABELS } from "./components/Panel";
import { ScannerView } from "./components/ScannerView";
import { SkeletonBlock, Welcome } from "./components/Welcome";
import { Topbar, type AuthStatus, type TabKey } from "./components/Topbar";
import { VerdictCard } from "./components/VerdictCard";
import {
  IconCapital,
  IconChart,
  IconDoc,
  IconFundamentals,
  IconHeart,
  IconInsider,
  IconNews,
  IconOptions,
} from "./components/icons";

type PanelKey = keyof Verdict["panels"];
const PANELS: PanelKey[] = ["fundamentals", "capital", "technical", "derivatives", "sentiment", "digest", "news", "insider"];

interface PanelState {
  status: "idle" | "loading" | "ready" | "error";
  summary?: PanelSummary;
  error?: string;
}

interface State {
  ticker: string;
  symbol: string;
  tickerInput: string;
  status: "idle" | "prepping" | "panels" | "verdict" | "done" | "error";
  topError: string | null;
  errors: { source: string; message: string }[];
  snapshot: SnapshotResult | null;
  portfolio: Portfolio | null;
  heldPositions: Position[];
  heldGroups: HeldGroup[];
  panels: Record<PanelKey, PanelState>;
  verdict: Verdict | null;
}

type Action =
  | { type: "set_input"; v: string }
  | { type: "submit_start"; ticker: string }
  | { type: "submit_error"; message: string }
  | { type: "prep_done"; payload: { ticker: string; symbol: string; snapshot: SnapshotResult; portfolio: Portfolio | null; heldPositions: Position[]; heldGroups: HeldGroup[]; errors: State["errors"] } }
  | { type: "panel_loading"; name: PanelKey }
  | { type: "panel_done"; name: PanelKey; summary: PanelSummary; error?: string }
  | { type: "verdict_loading" }
  | { type: "verdict_done"; verdict: Verdict }
  | { type: "verdict_error"; message: string }
  | { type: "set_portfolio"; p: Portfolio; heldGroups: HeldGroup[] }
  | { type: "hydrate_from_cache"; payload: BatchTickerPayload };

const emptyPanels: Record<PanelKey, PanelState> = PANELS.reduce(
  (acc, k) => { acc[k] = { status: "idle" }; return acc; },
  {} as Record<PanelKey, PanelState>,
);

const INITIAL: State = {
  ticker: "",
  symbol: "",
  tickerInput: "",
  status: "idle",
  topError: null,
  errors: [],
  snapshot: null,
  portfolio: null,
  heldPositions: [],
  heldGroups: [],
  panels: emptyPanels,
  verdict: null,
};

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "set_input":
      return { ...state, tickerInput: a.v };
    case "submit_start":
      return {
        ...INITIAL,
        tickerInput: a.ticker,
        portfolio: state.portfolio,
        heldGroups: state.heldGroups,
        status: "prepping",
        topError: null,
      };
    case "submit_error":
      return { ...state, status: "error", topError: a.message };
    case "prep_done":
      return {
        ...state,
        status: "panels",
        ticker: a.payload.ticker,
        symbol: a.payload.symbol,
        snapshot: a.payload.snapshot,
        portfolio: a.payload.portfolio ?? state.portfolio,
        heldPositions: a.payload.heldPositions,
        heldGroups: a.payload.heldGroups,
        errors: a.payload.errors,
        panels: PANELS.reduce(
          (acc, k) => { acc[k] = { status: "loading" }; return acc; },
          {} as Record<PanelKey, PanelState>,
        ),
      };
    case "panel_loading":
      return { ...state, panels: { ...state.panels, [a.name]: { status: "loading" } } };
    case "panel_done":
      return {
        ...state,
        panels: {
          ...state.panels,
          [a.name]: a.error
            ? { status: "error", summary: a.summary, error: a.error }
            : { status: "ready", summary: a.summary },
        },
      };
    case "verdict_loading":
      return { ...state, status: "verdict" };
    case "verdict_done":
      return { ...state, status: "done", verdict: a.verdict };
    case "verdict_error":
      return { ...state, status: "error", topError: a.message };
    case "set_portfolio":
      // Only overwrite heldGroups if a search hasn't already enriched them with
      // ticker-specific live Greeks (state.ticker is set after /api/prep).
      return {
        ...state,
        portfolio: a.p,
        heldGroups: state.ticker ? state.heldGroups : a.heldGroups,
      };
    case "hydrate_from_cache": {
      const panelsReady: Record<PanelKey, PanelState> = PANELS.reduce(
        (acc, k) => {
          acc[k] = { status: "ready", summary: a.payload.panels[k] };
          return acc;
        },
        {} as Record<PanelKey, PanelState>,
      );
      return {
        ...state,
        status: "done",
        topError: null,
        errors: [],
        ticker: a.payload.ticker,
        symbol: a.payload.symbol,
        tickerInput: a.payload.ticker,
        snapshot: a.payload.snapshot,
        portfolio: a.payload.portfolio ?? state.portfolio,
        heldPositions: a.payload.heldPositions,
        heldGroups: a.payload.heldGroups,
        panels: panelsReady,
        verdict: a.payload.verdict,
      };
    }
  }
}

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export default function Page() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("single");
  const [isAskAiOpen, setIsAskAiOpen] = useState(false);
  const [macroText, setMacroText] = useState<string | null>(null);
  const [macroStatus, setMacroStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // Mirror of macroText for runAnalysis to read without taking macroText as a
  // dependency — keeps runAnalysis identity stable so the URL-hydration effect
  // doesn't re-fire (and re-run a whole analysis) when macro lands.
  const macroTextRef = useRef<string | null>(null);

  // Macro briefing — fetched once on mount, cached in sessionStorage for the session.
  useEffect(() => {
    const CACHE_KEY = "macro_briefing_v1";
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      macroTextRef.current = cached;
      setMacroText(cached);
      setMacroStatus("ready");
      return;
    }
    setMacroStatus("loading");
    fetch("/api/macro")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { text?: string };
        const text = j.text ?? "";
        sessionStorage.setItem(CACHE_KEY, text);
        macroTextRef.current = text;
        setMacroText(text);
        setMacroStatus("ready");
      })
      .catch(() => setMacroStatus("error"));
  }, []);

  // Initial portfolio load (independent of any search) so the rail populates immediately.
  useEffect(() => {
    fetch("/api/portfolio").then(async (r) => {
      if (!r.ok) return;
      const p = (await r.json()) as Portfolio;
      const cash = (p.summary.totalCash ?? 0) + (p.summary.availableFunds ?? 0);
      const heldGroups = classifyPortfolio(p.positions ?? [], { cashAvailableForCsp: cash });
      annotateGroups(heldGroups);
      dispatch({ type: "set_portfolio", p, heldGroups });
    }).catch(() => {});
  }, []);

  // Auth pinger (unchanged from original).
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const r = await fetch("/api/tickle", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as {
          iserver?: { authStatus?: { authenticated: boolean; connected: boolean; competing: boolean } };
        };
        const a = j.iserver?.authStatus;
        setAuthStatus({
          ok: true,
          authenticated: !!a?.authenticated,
          connected: !!a?.connected,
          competing: !!a?.competing,
        });
      } catch {
        if (!cancelled) setAuthStatus({ ok: false, authenticated: false, connected: false, competing: false });
      }
    };
    ping();
    const id = setInterval(ping, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const runAnalysis = useCallback(async (rawTicker: string, opts?: { allowCache?: boolean }) => {
    const t = rawTicker.trim();
    if (!t) return;

    // Cache hit is opt-in so the Single search bar always refetches; only the
    // URL-ticker hydration on mount sets allowCache=true.
    if (opts?.allowCache) {
      const cached = loadBatchResult(t);
      if (cached) {
        abortRef.current?.abort();
        abortRef.current = null;
        dispatch({ type: "hydrate_from_cache", payload: cached });
        return;
      }
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    dispatch({ type: "submit_start", ticker: t });

    let prep: Awaited<ReturnType<typeof postJson<{ ticker: string; symbol: string; snapshot: SnapshotResult; portfolio: Portfolio | null; heldPositions: Position[]; heldGroups: HeldGroup[]; errors: State["errors"] }>>>;
    try {
      prep = await postJson("/api/prep", { ticker: t }, signal);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      dispatch({ type: "submit_error", message: (err as Error).message });
      return;
    }
    dispatch({ type: "prep_done", payload: prep });

    const panelResults = await Promise.allSettled(
      PANELS.map(async (name) => {
        const r = await postJson<{ name: PanelKey; summary: PanelSummary; error?: string }>(
          `/api/panel/${name}`,
          { ticker: prep.ticker },
          signal,
        );
        dispatch({ type: "panel_done", name: r.name, summary: r.summary, error: r.error });
        return r;
      }),
    );

    if (signal.aborted) return;

    const summaries: Record<PanelKey, PanelSummary> = PANELS.reduce(
      (acc, k) => { acc[k] = { headline: `${k} unavailable`, bullets: [], direction: "n/a", conclusion: "" }; return acc; },
      {} as Record<PanelKey, PanelSummary>,
    );
    panelResults.forEach((r, i) => {
      if (r.status === "fulfilled") summaries[PANELS[i]] = r.value.summary;
    });

    dispatch({ type: "verdict_loading" });
    let verdictRes: { verdict: Verdict };
    try {
      verdictRes = await postJson<{ verdict: Verdict }>(
        "/api/verdict",
        {
          ticker: prep.ticker,
          symbol: prep.symbol,
          snapshot: prep.snapshot,
          portfolio: prep.portfolio,
          heldPositions: prep.heldPositions,
          heldGroups: prep.heldGroups,
          macroContext: macroTextRef.current,
          panels: summaries,
        },
        signal,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      dispatch({ type: "verdict_error", message: (err as Error).message });
      return;
    }
    dispatch({ type: "verdict_done", verdict: { ...verdictRes.verdict, panels: { ...summaries } } });
  }, []);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void runAnalysis(state.tickerInput);
    },
    [runAnalysis, state.tickerInput],
  );

  const sendToBatch = useCallback((tickers: string[]) => {
    // Hand off via sessionStorage so BatchView reads the new tickers via its
    // own session-restore path on mount (no prop drilling + no Effect-from-prop
    // anti-pattern in the consumer).
    saveBatchSession({ input: tickers.join(", "), rows: [] });
    setActiveTab("batch");
  }, []);

  const changeTab = useCallback((next: TabKey) => {
    setActiveTab((prev) => {
      // Cancel in-flight Single-tab work when the user switches away — the
      // user doesn't see the result anyway, and continuing wastes LLM tokens.
      if (prev === "single" && next !== "single") {
        abortRef.current?.abort();
        abortRef.current = null;
      }
      return next;
    });
  }, []);

  // New-tab landing from a Batch card click: the URL carries ?ticker=, and
  // sessionStorage was inherited from the opener, so we hydrate Single from
  // cache without a refetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialTicker = params.get("ticker");
    if (!initialTicker) return;
    dispatch({ type: "set_input", v: initialTicker });
    void runAnalysis(initialTicker, { allowCache: true });
  }, [runAnalysis]);

  const heroData = useMemo<Verdict | null>(() => state.verdict, [state.verdict]);
  const askAiTicker = (state.ticker || state.tickerInput || "").trim();
  const askAiAvailable = activeTab === "single" && askAiTicker.length > 0;
  const showAside = activeTab === "single";

  return (
    <div className={styles.shell}>
      <Topbar
        ticker={state.tickerInput}
        setTicker={(v) => dispatch({ type: "set_input", v })}
        onSubmit={onSubmit}
        loading={state.status !== "idle" && state.status !== "done" && state.status !== "error"}
        authStatus={authStatus}
        activeTab={activeTab}
        onTabChange={changeTab}
        onOpenAskAi={() => setIsAskAiOpen(true)}
        askAiAvailable={askAiAvailable}
      />
      <div className={`${styles.body} ${showAside ? styles.bodyWithAside : ""}`}>
        <LeftRail
          portfolio={state.portfolio}
          heldGroups={state.heldGroups}
          searchedTicker={state.ticker}
          onPickTicker={(t) => {
            setActiveTab("single");
            dispatch({ type: "set_input", v: t });
          }}
        />
        <main className={`${styles.main} scrollbar-slim`}>
          <div className={styles.mainInner}>
            {activeTab === "scanner" && <ScannerView onSendToBatch={sendToBatch} />}
            {activeTab === "batch" && <BatchView />}
            {activeTab === "single" && (
              <>
            {state.snapshot ? (
              <Hero data={{
                ticker: state.ticker,
                symbol: state.symbol,
                generatedAt: new Date().toISOString(),
                snapshot: state.snapshot,
                capital: null, technical: null, derivatives: null, news: null,
                sentiment: null, fundamentals: null, portfolio: state.portfolio,
                heldPositions: state.heldPositions, heldGroups: state.heldGroups,
                verdict: heroData, errors: state.errors,
              }} />
            ) : (
              <div className={styles.heroEmpty}>
                <h1 className="font-display">Ticker analysis</h1>
                <p>Search a symbol above to synthesize capital flow, technicals, options activity, news, and community sentiment into a portfolio-aware verdict.</p>
              </div>
            )}

            {state.topError && (
              <div className={styles.errorBanner}>
                <strong>Request failed</strong>
                <span>{state.topError}</span>
              </div>
            )}

            {state.status === "prepping" && <SkeletonBlock />}

            {state.heldGroups.some((g) => g.underlying === state.ticker.toUpperCase() && g.kind !== "STOCK") && (
              <HeldOptionsDetail
                groups={state.heldGroups.filter((g) => g.underlying === state.ticker.toUpperCase())}
              />
            )}

            {state.verdict && (
              <VerdictCard
                data={{
                  ticker: state.ticker,
                  symbol: state.symbol,
                  generatedAt: new Date().toISOString(),
                  snapshot: state.snapshot,
                  capital: null, technical: null, derivatives: null, news: null,
                  sentiment: null, fundamentals: null, portfolio: state.portfolio,
                  heldPositions: state.heldPositions, heldGroups: state.heldGroups,
                  verdict: state.verdict, errors: state.errors,
                }}
              />
            )}

            {state.status === "verdict" && !state.verdict && (
              <div className={styles.errorBanner} style={{ background: "var(--surface-container)" }}>
                <strong>Synthesizing verdict…</strong>
                <span>Aggregating panels into the dual-sleeve recommendation.</span>
              </div>
            )}

            {!state.snapshot && state.status === "idle" && <Welcome />}

            {(macroStatus === "loading" || macroStatus === "ready" || macroStatus === "error") && (
              <MacroBriefing text={macroText} status={macroStatus} />
            )}

            {state.snapshot && (
              <div className={styles.panelGrid}>
                {PANELS.map((name) => {
                  const ps = state.panels[name];
                  return (
                    <Panel
                      key={name}
                      title={PANEL_LABELS[name]}
                      icon={panelIcon(name)}
                      summary={ps.status === "ready" || ps.status === "error" ? ps.summary : undefined}
                      fallback={ps.status === "loading" ? "Loading…" : ps.status === "error" ? `Failed: ${ps.error}` : undefined}
                    />
                  );
                })}
              </div>
            )}

            {state.errors.length > 0 && (
              <div className={styles.errorBanner}>
                <strong>Partial data — some sources errored</strong>
                {state.errors.slice(0, 5).map((e, i) => (
                  <span key={i}>{e.source}: {e.message}</span>
                ))}
              </div>
            )}
              </>
            )}
          </div>
        </main>
        {showAside && (
          <aside className={styles.askAiAside}>
            <AskAI ticker={askAiTicker} mode="inline" />
          </aside>
        )}
      </div>
      {/* Drawer is always mounted so the slide-out transition can play.
          It only opens when the user taps the topbar button (which itself is
          only visible below 1280px via CSS). */}
      {showAside && (
        <AskAI
          ticker={askAiTicker}
          mode="drawer"
          isOpen={isAskAiOpen}
          onClose={() => setIsAskAiOpen(false)}
        />
      )}
    </div>
  );
}

function panelIcon(name: PanelKey): ReactNode {
  switch (name) {
    case "capital": return <IconCapital />;
    case "technical": return <IconChart />;
    case "derivatives": return <IconOptions />;
    case "news": return <IconNews />;
    case "digest": return <IconDoc />;
    case "sentiment": return <IconHeart />;
    case "fundamentals": return <IconFundamentals />;
    case "insider": return <IconInsider />;
  }
}
