// Shared, dependency-free date helpers.

/** Returns whole UTC days from today to an ISO date (negative when past), or null if unparseable. */
export function daysUntilISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
}
