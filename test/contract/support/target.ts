/**
 * Contract suite configuration (ch. 7 §7.4). HTTP only: nothing here may
 * import from src/.
 *
 *   CONTRACT_BASE_URL=http://127.0.0.1:8010 CONTRACT_TARGET=laravel npm run test:contract
 *   CONTRACT_BASE_URL=http://127.0.0.1:8011 CONTRACT_TARGET=nest    npm run test:contract
 */
export const BASE_URL = (
  process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:8011'
).replace(/\/+$/, '');

export type Target = 'laravel' | 'nest';
export const TARGET: Target =
  process.env.CONTRACT_TARGET === 'laravel' ? 'laravel' : 'nest';

/**
 * Features the Nest port has built so far. The Laravel run executes every
 * case; the Nest run skips cases for features not listed here yet. Add each
 * feature as its plan phase lands.
 */
const NEST_FEATURES = new Set<Feature>(['core']);

export type Feature =
  | 'core'
  | 'auth'
  | 'forms'
  | 'entries'
  | 'submissions'
  | 'notifications'
  | 'exports'
  | 'webhooks';

/** `describe` that skips on Nest until the feature is built. */
export function describeFeature(
  feature: Feature,
  name: string,
  fn: () => void,
): void {
  const run = TARGET === 'laravel' || NEST_FEATURES.has(feature);
  (run ? describe : describe.skip)(`[${feature}] ${name}`, fn);
}

/**
 * Intentional differences (F7, F9): the case states what each server does.
 * `expected[TARGET]` picks the right expectation.
 */
export function byTarget<T>(expected: Record<Target, T>): T {
  return expected[TARGET];
}
