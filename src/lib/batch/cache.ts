import type { BatchTickerPayload } from "./protocol";

export type { BatchTickerPayload } from "./protocol";

const PAYLOAD_KEY = (ticker: string) => `batch:${ticker.trim().toUpperCase()}`;
const INDEX_KEY = "batch:_index";
const SESSION_KEY = "batch:_session";
const MAX_PAYLOADS = 30;

function readIndex(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((s) => typeof s === "string") as string[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]): void {
  try {
    sessionStorage.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    // Quota issues are non-fatal; index just won't update.
  }
}

// LRU eviction: bump touched key to the front, drop tail when over cap.
function touchIndex(key: string): void {
  const idx = readIndex().filter((k) => k !== key);
  idx.unshift(key);
  while (idx.length > MAX_PAYLOADS) {
    const evict = idx.pop();
    if (evict) {
      try {
        sessionStorage.removeItem(evict);
      } catch {
        // Ignore.
      }
    }
  }
  writeIndex(idx);
}

export function saveBatchResult(ticker: string, payload: BatchTickerPayload): void {
  if (typeof window === "undefined") return;
  const key = PAYLOAD_KEY(ticker);
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
    touchIndex(key);
  } catch {
    // Quota exceeded; oldest entry will be evicted on next save attempt via touchIndex.
  }
}

function isValidPayload(value: unknown): value is BatchTickerPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ticker === "string" &&
    typeof v.symbol === "string" &&
    !!v.snapshot &&
    !!v.verdict &&
    !!v.panels &&
    Array.isArray(v.heldPositions) &&
    Array.isArray(v.heldGroups)
  );
}

export function loadBatchResult(ticker: string): BatchTickerPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PAYLOAD_KEY(ticker));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearBatchResult(ticker: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PAYLOAD_KEY(ticker));
  } catch {
    // Ignore.
  }
}

// ----- BatchView session state (input + row statuses) -----
// Separate from the per-ticker payload cache; lets the Batch tab restore its
// last view when the user navigates away and back, or reloads the page.

export interface BatchSessionRow {
  ticker: string;
  stage: "idle" | "prep" | "panels" | "verdict" | "done" | "error";
  confidence: number | null;
  error: string | null;
}

export interface BatchSession {
  input: string;
  rows: BatchSessionRow[];
}

export function loadBatchSession(): BatchSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.input === "string" && Array.isArray(parsed.rows)) {
      return parsed as BatchSession;
    }
  } catch {
    // Fall through.
  }
  return null;
}

export function saveBatchSession(session: BatchSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Quota issues are non-fatal — session will just not persist this update.
  }
}

export function clearBatchSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore.
  }
}
