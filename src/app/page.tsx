"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import styles from "./page.module.css";
import type {
  ContractPick,
  HeldGroup,
  PanelSummary,
  Portfolio,
  Position,
  SnapshotResult,
  Verdict,
} from "../lib/types";
import { classifyPortfolio } from "../lib/positions/groups";
import { annotateGroups } from "../lib/positions/triggers";
import { Hero } from "./components/Hero";
import { HeldOptionsDetail } from "./components/HeldOptionsDetail";
import { LeftRail } from "./components/LeftRail";
import { Panel, PANEL_LABELS } from "./components/Panel";
import { SkeletonBlock, Welcome } from "./components/Welcome";
import { Topbar, type AuthStatus } from "./components/Topbar";
import { VerdictCard } from "./components/VerdictCard";
import {
  IconCapital,
  IconChart,
  IconDoc,
  IconFundamentals,
  IconHeart,
  IconNews,
  IconOptions,
} from "./components/icons";

type PanelKey = keyof Verdict["panels"];
const PANELS: PanelKey[] = ["fundamentals", "capital", "technical", "derivatives", "sentiment", "digest", "news"];

interface PanelState {
  status: "idle" | "loading" | "ready" | "error";
  summary?: PanelSummary;
  error?: string;
}

interface State {
  ticker: string;
  symbol: string;
  tickerInput: string;
  status: "idle" | "prepping" | "panels" | "verdict" | "picking" | "done" | "error";
  topError: string | null;
  pickError: string | null;
  errors: { source: string; message: string }[];
  snapshot: SnapshotResult | null;
  portfolio: Portfolio | null;
  heldPositions: Position[];
  heldGroups: HeldGroup[];
  panels: Record<PanelKey, PanelState>;
  verdict: Verdict | null;
  // Surfaced from the fundamentals panel response so we can forward it
  // to /api/contract-pick. Null when yfinance has no listed earnings date.
  nextEarningsDate: string | null;
}

type Action =
  | { type: "set_input"; v: string }
  | { type: "submit_start"; ticker: string }
  | { type: "submit_error"; message: string }
  | { type: "prep_done"; payload: { ticker: string; symbol: string; snapshot: SnapshotResult; portfolio: Portfolio | null; heldPositions: Position[]; heldGroups: HeldGroup[]; errors: State["errors"] } }
  | { type: "panel_loading"; name: PanelKey }
  | { type: "panel_done"; name: PanelKey; summary: PanelSummary; error?: string; nextEarningsDate?: string | null }
  | { type: "verdict_loading" }
  | { type: "verdict_done"; verdict: Verdict }
  | { type: "verdict_error"; message: string }
  | { type: "pick_loading" }
  | { type: "pick_done"; pick: ContractPick | null; error?: string }
  | { type: "set_portfolio"; p: Portfolio; heldGroups: HeldGroup[] };

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
  pickError: null,
  errors: [],
  snapshot: null,
  portfolio: null,
  heldPositions: [],
  heldGroups: [],
  panels: emptyPanels,
  verdict: null,
  nextEarningsDate: null,
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
        // Capture the earnings date when the fundamentals panel finishes —
        // it's what the contract picker needs for earnings-aware expiry.
        nextEarningsDate:
          a.name === "fundamentals" && a.nextEarningsDate !== undefined
            ? a.nextEarningsDate
            : state.nextEarningsDate,
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
      return { ...state, status: "picking", verdict: a.verdict };
    case "verdict_error":
      return { ...state, status: "error", topError: a.message };
    case "pick_loading":
      return { ...state, status: "picking" };
    case "pick_done":
      return state.verdict
        ? {
            ...state,
            status: "done",
            pickError: a.error ?? null,
            verdict: a.pick
              ? { ...state.verdict, derivatives: { ...state.verdict.derivatives, contractPick: a.pick } }
              : state.verdict,
          }
        : { ...state, status: "done", pickError: a.error ?? null };
    case "set_portfolio":
      // Only overwrite heldGroups if a search hasn't already enriched them with
      // ticker-specific live Greeks (state.ticker is set after /api/prep).
      return {
        ...state,
        portfolio: a.p,
        heldGroups: state.ticker ? state.heldGroups : a.heldGroups,
      };
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

  const onSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const t = state.tickerInput.trim();
    if (!t) return;

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

    // Fundamentals panel piggybacks the raw nextEarningsDate alongside its
    // summary so the contract picker can apply earnings-aware expiry rules.
    let fundamentalsEarningsDate: string | null = null;
    const panelResults = await Promise.allSettled(
      PANELS.map(async (name) => {
        const r = await postJson<{ name: PanelKey; summary: PanelSummary; error?: string; nextEarningsDate?: string | null }>(
          `/api/panel/${name}`,
          { ticker: prep.ticker },
          signal,
        );
        if (r.name === "fundamentals" && r.nextEarningsDate !== undefined) {
          fundamentalsEarningsDate = r.nextEarningsDate;
        }
        dispatch({ type: "panel_done", name: r.name, summary: r.summary, error: r.error, nextEarningsDate: r.nextEarningsDate });
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

    // Contract pick — only when the action is picker-eligible.
    const eligibleActions = new Set([
      "BUY_CALL_SPREAD", "BUY_PUT_SPREAD", "SELL_PUT_SPREAD", "SELL_CALL_SPREAD",
      "SELL_COVERED_CALL", "SELL_CASH_SECURED_PUT", "ROLL_OUT",
    ]);
    if (eligibleActions.has(verdictRes.verdict.derivatives.action)) {
      try {
        const pickRes = await postJson<{ pick: ContractPick | null }>(
          "/api/contract-pick",
          {
            ticker: prep.ticker,
            symbol: prep.symbol,
            snapshot: prep.snapshot,
            portfolio: prep.portfolio,
            heldPositions: prep.heldPositions,
            heldGroups: prep.heldGroups,
            verdict: verdictRes.verdict,
            nextEarningsDate: fundamentalsEarningsDate,
          },
          signal,
        );
        if (!signal.aborted) dispatch({ type: "pick_done", pick: pickRes.pick });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Picker errors are non-fatal — verdict stays without a pick. Surface
        // the message inline in the Derivatives Sleeve so the missing card
        // doesn't look like a feature.
        dispatch({ type: "pick_done", pick: null, error: (err as Error).message });
      }
    } else {
      dispatch({ type: "pick_done", pick: null });
    }
  }, [state.tickerInput]);

  const heroData = useMemo<Verdict | null>(() => state.verdict, [state.verdict]);

  return (
    <div className={styles.shell}>
      <Topbar
        ticker={state.tickerInput}
        setTicker={(v) => dispatch({ type: "set_input", v })}
        onSubmit={onSubmit}
        loading={state.status !== "idle" && state.status !== "done" && state.status !== "error"}
        authStatus={authStatus}
      />
      <div className={styles.body}>
        <LeftRail
          portfolio={state.portfolio}
          heldGroups={state.heldGroups}
          searchedTicker={state.ticker}
          onPickTicker={(t) => dispatch({ type: "set_input", v: t })}
        />
        <main className={`${styles.main} scrollbar-slim`}>
          <div className={styles.mainInner}>
            {state.snapshot ? (
              <Hero data={{
                ticker: state.ticker,
                symbol: state.symbol,
                generatedAt: new Date().toISOString(),
                snapshot: state.snapshot,
                capital: null, technical: null, derivatives: null, news: null, digest: null,
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
                isPickLoading={state.status === "picking"}
                pickError={state.pickError}
                data={{
                  ticker: state.ticker,
                  symbol: state.symbol,
                  generatedAt: new Date().toISOString(),
                  snapshot: state.snapshot,
                  capital: null, technical: null, derivatives: null, news: null, digest: null,
                  sentiment: null, fundamentals: null, portfolio: state.portfolio,
                  heldPositions: state.heldPositions, heldGroups: state.heldGroups,
                  verdict: state.verdict, errors: state.errors,
                }}
              />
            )}

            {(state.status === "verdict" || state.status === "picking") && !state.verdict && (
              <div className={styles.errorBanner} style={{ background: "var(--surface-container)" }}>
                <strong>Synthesizing verdict…</strong>
                <span>Aggregating panels into the dual-sleeve recommendation.</span>
              </div>
            )}

            {!state.snapshot && state.status === "idle" && <Welcome />}

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
          </div>
        </main>
      </div>
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
  }
}
