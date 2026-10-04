/**
 * Laravel's JSON date format: ISO 8601 in UTC with six fractional digits,
 * e.g. `2026-01-02T03:04:05.000000Z` (ch. 3 §3.2). Stored values are whole
 * seconds, so the digits are always `000000`.
 */
export function toLaravelIso(date: Date): string;
export function toLaravelIso(date: Date | null | undefined): string | null;
export function toLaravelIso(date: Date | null | undefined): string | null {
  if (date === null || date === undefined) return null;
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}
