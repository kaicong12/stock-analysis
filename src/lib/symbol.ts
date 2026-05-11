const PREFIXES = new Set(["US", "HK", "SH", "SZ", "SG"]);

// Index tickers that aren't available on moomoo's get_market_snapshot get
// rewritten to their tradeable ETF proxy. This is also what retail actually
// trades — SPX/NDX index options are CBOE-only products with cash settlement
// and different tax treatment, so the ETF is the practical instrument.
const INDEX_TO_ETF: Record<string, string> = {
  SPX: "SPY",   // S&P 500
  NDX: "QQQ",   // Nasdaq 100
  DJX: "DIA",   // Dow 30
  RUT: "IWM",   // Russell 2000
  GSPC: "SPY",  // Yahoo-style ^GSPC
  IXIC: "QQQ",  // Yahoo-style ^IXIC
};

export function normalizeSymbol(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) throw new Error("ticker is required");
  const dotIdx = trimmed.indexOf(".");
  // Strip optional market prefix to look up the bare ticker for aliasing.
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

export function ticker(symbol: string): string {
  const dotIdx = symbol.indexOf(".");
  return dotIdx > 0 ? symbol.slice(dotIdx + 1) : symbol;
}
