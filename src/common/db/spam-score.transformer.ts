import type { ValueTransformer } from 'typeorm';

/**
 * PHP's `round($value, $places)`: half away from zero on the number's
 * shortest decimal form, so `0.285` → `0.29` and `1.005` → `1.01`, where
 * `Math.round(x * 100) / 100` gives `0.28` and `1`.
 */
export function phpRound(value: number, places = 0): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const shifted = String(abs).includes('e')
    ? abs * 10 ** places
    : Number(`${abs}e${places}`);
  const rounded = Math.round(shifted) / 10 ** places;
  return rounded === 0 ? 0 : sign * rounded;
}

/**
 * `form_entries.spam_score`, `numeric(3,2)`: rounded to 2 decimals on write
 * (Laravel's `spamScore` mutator) and read back as a number (Postgres returns
 * `numeric` as a string).
 */
export const spamScoreTransformer: ValueTransformer = {
  to: (value: unknown) =>
    typeof value === 'number' || typeof value === 'string'
      ? phpRound(Number(value), 2)
      : value,
  from: (value: unknown) =>
    value === null || value === undefined ? value : Number(value),
};
