// Dashboard page — drives the prep, earnings gate, panel and verdict sequence.

"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PanelSummary, SnapshotResult, Verdict } from "../lib/types";
import { EarningsGate, ErrorBanner } from "./components/Banners";
import { Hero } from "./components/Hero";
import { MacroBriefing } from "./components/MacroBriefing";
import { Panel, PANEL_ICONS, PANEL_LABELS } from "./components/Panel";
import { HeroEmpty, MAIN, MAIN_INNER, PANEL_GRID, SHELL } from "./components/Shell";
import { SkeletonBlock, Welcome } from "./components/Welcome";
import { StrikeDesk } from "./components/StrikeDesk";
import { Topbar } from "./components/Topbar";
import { VerdictCard } from "./components/VerdictCard";

type PanelKey = keyof Verdict["panels"];
const PANELS: PanelKey[] = ["fundamentals", "capital", "technical", "sentiment", "digest", "news", "insider"];

// Covers the "no binary events inside the 30-45 DTE expiry window" rule; the gate warns, not blocks.
const EARNINGS_GATE_DAYS = 45;

type PrepPayload = {
  ticker: string;
  symbol: string;
  snapshot: SnapshotResult;
  errors: State["errors"];
  nextEarningsDate: string | null;
  earningsDaysAway: number | null;
};

interface PanelState {
  status: "idle" | "loading" | "ready" | "error";
  summary?: PanelSummary;
  error?: string;
}

interface State {
  ticker: string;
  symbol: string;
  tickerInput: string;
  status: "idle" | "prepping" | "earnings_gate" | "panels" | "verdict" | "done" | "error";
  topError: string | null;
  errors: { source: string; message: string }[];
  snapshot: SnapshotResult | null;
  panels: Record<PanelKey, PanelState>;
  verdict: Verdict | null;
  earningsDaysAway: number | null;
  nextEarningsDate: string | null;
}

type Action =
  | { type: "set_input"; v: string }
  | { type: "submit_start"; ticker: string }
  | { type: "submit_error"; message: string }
  | { type: "reset" }
  | { type: "earnings_gate"; payload: PrepPayload }
  | { type: "prep_done"; payload: PrepPayload }
  | { type: "panel_loading"; name: PanelKey }
  | { type: "panel_done"; name: PanelKey; summary: PanelSummary; error?: string }
  | { type: "verdict_loading" }
  | { type: "verdict_done"; verdict: Verdict }
  | { type: "verdict_error"; message: string };

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
  panels: emptyPanels,
  verdict: null,
  earningsDaysAway: null,
  nextEarningsDate: null,
};

// Applies one action to the page state.
function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "set_input":
      return { ...state, tickerInput: a.v };
    case "submit_start":
      return {
        ...INITIAL,
        tickerInput: a.ticker,
        status: "prepping",
        topError: null,
      };
    case "submit_error":
      return { ...state, status: "error", topError: a.message };
    case "reset":
      return { ...INITIAL };
    case "earnings_gate":
      return {
        ...state,
        status: "earnings_gate",
        ticker: a.payload.ticker,
        symbol: a.payload.symbol,
        snapshot: a.payload.snapshot,
        errors: a.payload.errors,
        earningsDaysAway: a.payload.earningsDaysAway,
        nextEarningsDate: a.payload.nextEarningsDate,
      };
    case "prep_done":
      return {
        ...state,
        status: "panels",
        ticker: a.payload.ticker,
        symbol: a.payload.symbol,
        snapshot: a.payload.snapshot,
        errors: a.payload.errors,
        earningsDaysAway: a.payload.earningsDaysAway,
        nextEarningsDate: a.payload.nextEarningsDate,
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
  }
}

// POSTs a JSON body and resolves the parsed response, throwing the API's error message.
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

/** Renders the dashboard and orchestrates the analysis run for one ticker. */
export default function Page() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  // Held while the gate is open so "Continue anyway" resumes without re-prepping.
  const pendingPrepRef = useRef<{ prep: PrepPayload; signal: AbortSignal } | null>(null);

  const [macroText, setMacroText] = useState<string | null>(null);
  const [macroStatus, setMacroStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // Read in place of macroText so runAnalysis's identity stays stable and the URL-hydration effect can't re-fire.
  const macroTextRef = useRef<string | null>(null);

  // The cache read stays in an effect — lazy useState init would risk an SSR hydration mismatch.
  useEffect(() => {
    const CACHE_KEY = "macro_briefing_v1";
    const cached = sessionStorage.getItem(CACHE_KEY);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (cached) {
      macroTextRef.current = cached;
      setMacroText(cached);
      setMacroStatus("ready");
      return;
    }
    setMacroStatus("loading");
    /* eslint-enable react-hooks/set-state-in-effect */
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

  // Runs every panel then the synth verdict; split out so the earnings gate can defer it.
  const runPanelsAndVerdict = useCallback(async (prep: PrepPayload, signal: AbortSignal) => {
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

  // Preps the ticker, then either opens the earnings gate or runs the panels.
  const runAnalysis = useCallback(async (rawTicker: string) => {
    const t = rawTicker.trim();
    if (!t) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    dispatch({ type: "submit_start", ticker: t });

    let prep: PrepPayload;
    try {
      prep = await postJson("/api/prep", { ticker: t }, signal);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      dispatch({ type: "submit_error", message: (err as Error).message });
      return;
    }

    const dte = prep.earningsDaysAway;
    if (dte != null && dte >= 0 && dte <= EARNINGS_GATE_DAYS) {
      pendingPrepRef.current = { prep, signal };
      dispatch({ type: "earnings_gate", payload: prep });
      return;
    }

    dispatch({ type: "prep_done", payload: prep });
    await runPanelsAndVerdict(prep, signal);
  }, [runPanelsAndVerdict]);

  // Resumes the deferred panel run when the user accepts the earnings gate.
  const continueFromGate = useCallback(() => {
    const pending = pendingPrepRef.current;
    if (!pending || pending.signal.aborted) return;
    pendingPrepRef.current = null;
    dispatch({ type: "prep_done", payload: pending.prep });
    void runPanelsAndVerdict(pending.prep, pending.signal);
  }, [runPanelsAndVerdict]);

  // Aborts the pending run and returns to idle when the user declines the gate.
  const cancelGate = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pendingPrepRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void runAnalysis(state.tickerInput);
    },
    [runAnalysis, state.tickerInput],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialTicker = params.get("ticker");
    if (!initialTicker) return;
    dispatch({ type: "set_input", v: initialTicker });
    void runAnalysis(initialTicker);
  }, [runAnalysis]);

  const heroData = useMemo<Verdict | null>(() => state.verdict, [state.verdict]);

  return (
    <div className={SHELL}>
      <Topbar
        ticker={state.tickerInput}
        setTicker={(v) => dispatch({ type: "set_input", v })}
        onSubmit={onSubmit}
        loading={state.status !== "idle" && state.status !== "done" && state.status !== "error" && state.status !== "earnings_gate"}
      />
      <div className="grid min-h-0 grid-cols-1">
        <main className={MAIN}>
          <div className={MAIN_INNER}>
            {state.snapshot ? (
              <Hero data={{
                ticker: state.ticker,
                symbol: state.symbol,
                generatedAt: new Date().toISOString(),
                snapshot: state.snapshot,
                capital: null, technical: null, news: null,
                sentiment: null, fundamentals: null,
                verdict: heroData, errors: state.errors,
              }} />
            ) : (
              <HeroEmpty />
            )}

            {state.topError && (
              <ErrorBanner title="Request failed">
                <span>{state.topError}</span>
              </ErrorBanner>
            )}

            {state.status === "prepping" && <SkeletonBlock />}

            {state.status === "earnings_gate" && (
              <EarningsGate
                ticker={state.ticker}
                daysAway={state.earningsDaysAway}
                date={state.nextEarningsDate}
                windowDays={EARNINGS_GATE_DAYS}
                onContinue={continueFromGate}
                onCancel={cancelGate}
              />
            )}

            {state.verdict && (
              <VerdictCard
                data={{
                  ticker: state.ticker,
                  symbol: state.symbol,
                  generatedAt: new Date().toISOString(),
                  snapshot: state.snapshot,
                  capital: null, technical: null, news: null,
                  sentiment: null, fundamentals: null,
                  verdict: state.verdict, errors: state.errors,
                }}
              />
            )}

            {state.verdict && <StrikeDesk symbol={state.symbol} ticker={state.ticker} />}

            {state.status === "verdict" && !state.verdict && (
              <ErrorBanner title="Synthesizing verdict…" tone="info">
                <span>Aggregating panels into the dual-sleeve recommendation.</span>
              </ErrorBanner>
            )}

            {!state.snapshot && state.status === "idle" && <Welcome />}

            {(macroStatus === "loading" || macroStatus === "ready" || macroStatus === "error") && (
              <MacroBriefing text={macroText} status={macroStatus} />
            )}

            {state.snapshot && state.status !== "earnings_gate" && (
              <div className={PANEL_GRID}>
                {PANELS.map((name) => {
                  const ps = state.panels[name];
                  return (
                    <Panel
                      key={name}
                      title={PANEL_LABELS[name]}
                      icon={PANEL_ICONS[name]}
                      summary={ps.status === "ready" || ps.status === "error" ? ps.summary : undefined}
                      fallback={ps.status === "loading" ? "Loading…" : ps.status === "error" ? `Failed: ${ps.error}` : undefined}
                    />
                  );
                })}
              </div>
            )}

            {state.errors.length > 0 && (
              <ErrorBanner title="Partial data — some sources errored">
                {state.errors.slice(0, 5).map((e, i) => (
                  <span key={i}>{e.source}: {e.message}</span>
                ))}
              </ErrorBanner>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

