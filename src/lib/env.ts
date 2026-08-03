function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

export const env = {
  // Google AI Studio key — the sole LLM provider, powering both the structured
  // and the grounded path. Free tier works (15 RPM / 1500 RPD).
  geminiApiKey: required("GEMINI_API_KEY"),
  // Structured, non-grounded path (panels + synth verdict). Reasons only over
  // data already in the prompt, so it rides the cheap "lite" model.
  geminiStructuredModel: process.env.GEMINI_STRUCTURED_MODEL ?? "gemini-2.5-flash-lite",
  // Web-grounded path (Stock Digest + Macro). Browses via Google Search and
  // wants the more capable model.
  geminiGroundedModel: process.env.GEMINI_GROUNDED_MODEL ?? "gemini-2.5-flash",
  pyBackendUrl: process.env.PYBACKEND_URL ?? "http://localhost:8765",
  // Massive (ex-Polygon.io) — SEC Form 4 insider transactions. Optional at module
  // load; the insider client degrades to an empty panel when the key is absent.
  massiveApiKey: process.env.MASSIVE_API_KEY ?? "",
};
