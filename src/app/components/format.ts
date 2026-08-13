// Number, currency and time formatting helpers shared across the dashboard.

/** Formats a number as abbreviated currency for the given ISO code. */
export function fmtMoney(n: number, cur: string): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  let value: string;
  if (abs >= 1_000_000) value = (n / 1_000_000).toFixed(2) + "M";
  else if (abs >= 10_000) value = Math.round(n).toLocaleString("en-SG");
  else if (abs >= 1) value = n.toLocaleString("en-SG", { maximumFractionDigits: 2 });
  else value = n.toFixed(2);
  const symbol = cur === "SGD" ? "S$ " : cur === "USD" ? "$" : cur === "HKD" ? "HK$ " : `${cur} `;
  return symbol + value;
}

/** Formats currency with an explicit plus sign on positives. */
export function fmtSigned(n: number, cur: string): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + fmtMoney(n, cur);
}

/** Formats a number to at most two decimals, or an em dash when not finite. */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Renders an epoch-seconds timestamp as a relative age, falling back to a date. */
export function relTime(epochSeconds: number): string {
  if (!epochSeconds) return "";
  const ms = epochSeconds * 1000;
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString("en-SG", { month: "short", day: "numeric" });
}
