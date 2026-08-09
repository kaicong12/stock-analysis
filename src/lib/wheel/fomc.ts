// The Fed's own machine-readable calendar. `days` on an "FOMC Meeting" row is
// the single day-2 decision date (the 2:00 p.m. statement), not the meeting span.
const CALENDAR_URL = "https://www.federalreserve.gov/json/calendar.json";
const TTL_MS = 24 * 60 * 60 * 1000;

interface FedEvent {
  month?: string;
  days?: string;
  type?: string;
  title?: string;
}

let cache: { dates: string[]; at: number } | null = null;
let inflight: Promise<string[]> | null = null;

async function load(): Promise<string[]> {
  const res = await fetch(CALENDAR_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // The feed is served with a UTF-8 BOM, which JSON.parse rejects.
  const raw = (await res.text()).replace(/^﻿/, "");
  const events = (JSON.parse(raw) as { events?: FedEvent[] }).events ?? [];

  const dates = events
    .filter((e) => e.type === "FOMC" && e.title === "FOMC Meeting")
    .map((e) => {
      const day = Number(e.days);
      if (!e.month || !/^\d{4}-\d{2}$/.test(e.month) || !Number.isInteger(day)) return null;
      return `${e.month}-${String(day).padStart(2, "0")}`;
    })
    .filter((d): d is string => d !== null);

  return [...new Set(dates)].sort();
}

// Every FOMC decision date the Fed publishes, ascending. Returns [] on any
// failure — a missing runway marker degrades the desk, it never blocks it.
export async function fetchFomcDates(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.dates;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const dates = await load();
      cache = { dates, at: Date.now() };
      return dates;
    } catch (e) {
      console.error("[fomc] calendar fetch failed:", (e as Error).message);
      return cache?.dates ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
