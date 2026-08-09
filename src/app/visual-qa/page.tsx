"use client";

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { EarningsGate, ErrorBanner } from "../components/Banners";
import { HeroEmpty, MAIN, MAIN_INNER, PANEL_GRID, SHELL } from "../components/Shell";
import { Hero } from "../components/Hero";
import { MacroBriefing } from "../components/MacroBriefing";
import { Panel, PANEL_ICONS, PANEL_LABELS } from "../components/Panel";
import { SkeletonBlock, Welcome } from "../components/Welcome";
import { Topbar } from "../components/Topbar";
import { VerdictCard } from "../components/VerdictCard";
import { ChartLine, Newspaper } from "lucide-react";
import type { PanelKey } from "../../lib/types";
import { dashboard, macroText, panels, wheelPlan } from "./fixtures";

if (typeof window !== "undefined") {
  const real = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/wheel")) {
      return Promise.resolve(new Response(JSON.stringify({ plan: wheelPlan }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

const PANEL_ORDER: PanelKey[] = ["fundamentals", "capital", "technical", "wheel", "sentiment", "digest", "news", "insider"];


function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-vis={id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="label-caps" style={{ borderBottom: "1px dashed var(--outline-variant)", paddingBottom: 6 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

// Fixture-driven render of every component in its data-rich, loading and error
// states — the surface Playwright screenshots against. Dev-only.
export default function VisualPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className={SHELL}>
      <Topbar ticker="GOOGL" setTicker={() => {}} onSubmit={(e) => e.preventDefault()} loading={false} />
      <div className="grid min-h-0 grid-cols-1">
        <main className={MAIN}>
          <div className={MAIN_INNER} style={{ gap: 36 }}>
            <Section id="hero" title="Hero — with levels strip">
              <Hero data={dashboard} />
            </Section>

            <Section id="hero-empty" title="Hero — empty state">
              <HeroEmpty />
            </Section>

            <Section id="welcome" title="Welcome card">
              <Welcome />
            </Section>

            <Section id="macro-ready" title="Macro briefing — ready">
              <MacroBriefing text={macroText} status="ready" />
            </Section>

            <Section id="macro-loading" title="Macro briefing — loading / error">
              <MacroBriefing text={null} status="loading" />
              <MacroBriefing text={null} status="error" />
            </Section>

            <Section id="earnings-gate" title="Earnings gate">
              <EarningsGate
                ticker="GOOGL"
                daysAway={12}
                date="2026-08-20"
                windowDays={45}
                onContinue={() => {}}
                onCancel={() => {}}
              />
            </Section>

            <Section id="errors" title="Error banners">
              <ErrorBanner title="Request failed">
                <span>Gemini grounded call returned 503 after 2 retries.</span>
              </ErrorBanner>
              <ErrorBanner title="Partial data — some sources errored">
                {dashboard.errors.map((e, i) => <span key={i}>{e.source}: {e.message}</span>)}
              </ErrorBanner>
              <ErrorBanner title="Synthesizing verdict…" tone="info">
                <span>Aggregating panels into the dual-sleeve recommendation.</span>
              </ErrorBanner>
            </Section>

            <Section id="verdict" title="Verdict card — both sleeves + wheel pane">
              <VerdictCard data={dashboard} />
            </Section>

            <Section id="panels" title="Panel grid — all eight">
              <div className={PANEL_GRID}>
                {PANEL_ORDER.map((name) => (
                  <Panel key={name} title={PANEL_LABELS[name]} icon={PANEL_ICONS[name]} summary={panels[name]} />
                ))}
              </div>
            </Section>

            <Section id="panel-states" title="Panel — loading / error / empty">
              <div className={PANEL_GRID}>
                <Panel title="Loading" icon={<ChartLine />} fallback="Loading…" />
                <Panel title="Errored" icon={<Newspaper />} fallback="Failed: upstream timeout after 30s" />
              </div>
            </Section>

            <Section id="skeleton" title="Skeleton block">
              <SkeletonBlock />
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}
