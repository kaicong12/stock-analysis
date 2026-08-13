// Environment configuration, read once at module load.

// Reads an env var, throwing when it is missing.
function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

export const env = {
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  openrouterModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite-preview",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiGroundedModel: process.env.GEMINI_GROUNDED_MODEL ?? "gemini-2.5-flash",
  // Referer headers OpenRouter uses for free-tier accounting.
  openrouterAppUrl: process.env.OPENROUTER_APP_URL ?? "http://localhost:3000",
  openrouterAppTitle: process.env.OPENROUTER_APP_TITLE ?? "Alpha Insights",
  pyBackendUrl: process.env.PYBACKEND_URL ?? "http://localhost:8765",
  massiveApiKey: process.env.MASSIVE_API_KEY ?? "",
};
