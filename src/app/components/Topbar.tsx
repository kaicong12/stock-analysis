"use client";

import type { FormEvent } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function Topbar({
  ticker,
  setTicker,
  onSubmit,
  loading,
}: {
  ticker: string;
  setTicker: (s: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 grid grid-cols-[auto_1fr_auto] items-center gap-6 border-b border-outline-variant bg-surface-low px-6 py-3">
      <div className="flex items-center gap-6">
        <div className="font-heading text-[13px] font-bold tracking-[0.16em] text-on-surface max-[1024px]:hidden">
          ALPHA INSIGHTS
        </div>
      </div>
      <form onSubmit={onSubmit}>
        <div className="relative w-full max-w-[480px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-on-surface-variant/60"
          />
          <Input
            className="h-8 border-outline-variant bg-surface-container pr-3 pl-[34px] text-[13px] tracking-[0.02em] transition-colors placeholder:opacity-60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/12 md:text-[13px]"
            placeholder="Search ticker (e.g. GOOGL, AAPL, HK.00700)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          {loading && (
            <span className="label-caps absolute top-1/2 right-3 -translate-y-1/2">Analyzing…</span>
          )}
        </div>
      </form>
    </header>
  );
}
