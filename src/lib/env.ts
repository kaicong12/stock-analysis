function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

export const env = {
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  openrouterModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite-preview",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  // Optional referer headers OpenRouter uses for free-tier accounting / dashboard attribution.
  openrouterAppUrl: process.env.OPENROUTER_APP_URL ?? "http://localhost:3000",
  openrouterAppTitle: process.env.OPENROUTER_APP_TITLE ?? "Alpha Insights",
  ibkrBaseUrl: process.env.IBKR_BASE_URL ?? "https://localhost:5001",
  // Flex Web Service is a separate IBKR endpoint (not the gateway). Both vars
  // are optional at module load so unrelated routes don't fail to boot when
  // they're missing — the sync layer validates at call time.
  ibkrFlexToken: process.env.IBKR_FLEX_TOKEN ?? "",
  ibkrFlexQueryId: process.env.IBKR_FLEX_QUERY_ID ?? "",
  pyBackendUrl: process.env.PYBACKEND_URL ?? "http://localhost:8765",
};
