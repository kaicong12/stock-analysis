import type { CommentSentimentResult, PanelSummary } from "../../types";

export interface PanelContext {
  ticker: string;
  symbol: string;
}

export const DIRECTION_ENUM = ["bullish", "bearish", "neutral", "mixed", "n/a"];

const BASE_PROPS = {
  direction: { type: "string", enum: DIRECTION_ENUM },
  headline: { type: "string" },
  conclusion: { type: "string" },
  bullets: { type: "array", items: { type: "string" } },
};

export function baseSchema(
  extraProps: Record<string, unknown> = {},
  extraRequired: string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...BASE_PROPS, ...extraProps },
    required: ["direction", "headline", "conclusion", "bullets", ...extraRequired],
  };
}

export const EVIDENCE_PROP = {
  evidence: {
    type: "array",
    items: {
      type: "object",
      properties: {
        title: { type: "string" },
        url: { type: "string" },
      },
      required: ["title", "url"],
    },
  },
};

export const META_PROP = {
  meta: {
    type: "array",
    items: {
      type: "object",
      properties: {
        label: { type: "string" },
        value: { type: "string" },
      },
      required: ["label", "value"],
    },
  },
};

export function relAge(epochSeconds: number, nowMs: number): string {
  if (!epochSeconds) return "unknown";
  const diff = nowMs - epochSeconds * 1000;
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${Math.max(m, 0)}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function compressFeed(input: CommentSentimentResult, max: number, nowMs: number) {
  return input.posts.slice(0, max).map((p) => ({
    title: p.title ?? "",
    desc: (p.desc ?? "").slice(0, 400),
    publishedAgo: relAge(p.publishTime, nowMs),
  }));
}

export function emptyPanel(headline: string): PanelSummary {
  return {
    headline,
    bullets: [],
    direction: "n/a",
    conclusion: "No data available for this signal.",
  };
}

export function emptyEvidencePanel(headline: string): PanelSummary {
  return { ...emptyPanel(headline), evidence: [] };
}

export function emptySentimentPanel(): PanelSummary {
  return {
    ...emptyPanel("No community discussion available."),
    meta: [
      { label: "Bullish", value: "—" },
      { label: "Bearish", value: "—" },
      { label: "Neutral", value: "—" },
      { label: "Posts", value: "0" },
    ],
  };
}
