// Shared date helpers. Kept dependency-free so both API routes and the Gemini
// panels can use them without pulling in heavier modules.

// Whole days from today (UTC) to an ISO date string (YYYY-MM-DD anywhere in it).
// Returns null when the input is missing or unparseable. Negative when the date
// is in the past.
export function daysUntilISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
}
