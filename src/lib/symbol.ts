// Symbol normalization between bare tickers and moomoo's market-prefixed codes.

const PREFIXES = new Set(["US", "HK", "SH", "SZ", "SG"]);

// Index tickers moomoo cannot quote, rewritten to their tradeable ETF proxy.
const INDEX_TO_ETF: Record<string, string> = {
  SPX: "SPY",   // S&P 500
  NDX: "QQQ",   // Nasdaq 100
  DJX: "DIA",   // Dow 30
  RUT: "IWM",   // Russell 2000
  GSPC: "SPY",  // Yahoo-style ^GSPC
  IXIC: "QQQ",  // Yahoo-style ^IXIC
};

/** Normalizes user input to a moomoo symbol, defaulting to the US market and aliasing indices. */
export function normalizeSymbol(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) throw new Error("ticker is required");
  const dotIdx = trimmed.indexOf(".");
  const bare = dotIdx > 0 && PREFIXES.has(trimmed.slice(0, dotIdx))
    ? trimmed.slice(dotIdx + 1)
    : trimmed;
  const aliased = INDEX_TO_ETF[bare];
  if (aliased) return `US.${aliased}`;
  if (dotIdx > 0) {
    const prefix = trimmed.slice(0, dotIdx);
    if (PREFIXES.has(prefix)) return trimmed;
  }
  return `US.${trimmed}`;
}

/** Strips the market prefix from a moomoo symbol, yielding the bare ticker. */
export function ticker(symbol: string): string {
  const dotIdx = symbol.indexOf(".");
  return dotIdx > 0 ? symbol.slice(dotIdx + 1) : symbol;
}
