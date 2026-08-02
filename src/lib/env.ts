function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

export const env = {
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  openrouterModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite-preview",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  // Gemini direct API — free-tier key from AI Studio works (15 RPM / 1500 RPD).
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  // Model for web-grounded surfaces (Stock Digest panel + Macro briefing).
  // These browse live via Google Search and want a more capable model than the
  // cheap OpenRouter structured-panel path (openrouterModel).
  geminiGroundedModel: process.env.GEMINI_GROUNDED_MODEL ?? "gemini-2.5-flash",
  // Optional referer headers OpenRouter uses for free-tier accounting / dashboard attribution.
  openrouterAppUrl: process.env.OPENROUTER_APP_URL ?? "http://localhost:3000",
  openrouterAppTitle: process.env.OPENROUTER_APP_TITLE ?? "Alpha Insights",
  pyBackendUrl: process.env.PYBACKEND_URL ?? "http://localhost:8765",
  // Massive (ex-Polygon.io) — SEC Form 4 insider transactions. Optional at module
  // load; the insider client degrades to an empty panel when the key is absent.
  massiveApiKey: process.env.MASSIVE_API_KEY ?? "",
};
