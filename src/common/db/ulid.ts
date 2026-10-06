import { monotonicFactory } from 'ulid';

/**
 * Monotonic, as Symfony's `Ulid::generate()` is: IDs made in the same
 * millisecond still sort in creation order. Lists sort by a whole-second
 * timestamp then `id`, so this keeps "oldest first" true within a second.
 */
const ulid = monotonicFactory();

/** Model IDs are lowercase ULIDs, as Laravel's `HasUlids` generates them. */
export function newUlid(): string {
  return ulid().toLowerCase();
}

const CROCKFORD = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

/**
 * Laravel's `Str::isUlid()`: 26 Crockford base32 characters in either case,
 * with a first character no greater than `7`. Route IDs that fail this get
 * 404 without a query. Ones that pass are still matched exactly, case
 * included (ch. 2 §2.1).
 */
export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && CROCKFORD.test(value) && value[0] <= '7';
}
