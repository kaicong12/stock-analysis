function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

export const env = {
  // Google Gemini direct API (Google AI Studio key) — the sole LLM provider.
  // Required: it now powers BOTH the structured-JSON path (panels + synth) and
  // the web-grounded path (Stock Digest + Ask AI + Macro). Free-tier key works
  // (15 RPM / 1500 RPD), no billing required.
  geminiApiKey: required("GEMINI_API_KEY"),
  // Structured, NON-grounded path (panels + synth verdict via genJson). These
  // reason over data already in the prompt — they don't browse — so they ride
  // the cheap "lite" model. Replaces the former OpenRouter structured path.
  geminiStructuredModel: process.env.GEMINI_STRUCTURED_MODEL ?? "gemini-2.5-flash-lite",
  // Web-grounded path: Stock Digest panel + Ask AI + Macro briefing. These browse
  // live via Google Search and want the more capable (pricier) model than the
  // structured lite path above.
  geminiGroundedModel: process.env.GEMINI_GROUNDED_MODEL ?? "gemini-2.5-flash",
  ibkrBaseUrl: process.env.IBKR_BASE_URL ?? "https://localhost:5001",
  // Flex Web Service is a separate IBKR endpoint (not the gateway). Both vars
  // are optional at module load so unrelated routes don't fail to boot when
  // they're missing — the sync layer validates at call time.
  ibkrFlexToken: process.env.IBKR_FLEX_TOKEN ?? "",
  ibkrFlexQueryId: process.env.IBKR_FLEX_QUERY_ID ?? "",
  pyBackendUrl: process.env.PYBACKEND_URL ?? "http://localhost:8765",
  // Massive (ex-Polygon.io) — SEC Form 4 insider transactions. Optional at module
  // load; the insider client degrades to an empty panel when the key is absent.
  massiveApiKey: process.env.MASSIVE_API_KEY ?? "",
};
