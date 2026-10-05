import { randomInt } from 'node:crypto';
import { strRandom } from '../common/support/str';

/** Contact details bots tend to fill in, so the honeypot looks like a real field. */
export const HONEYPOT_PREFIXES = [
  'website',
  'homepage',
  'url',
  'company',
] as const;

/**
 * `GenerateHoneypotName`: a realistic input name with a random suffix, e.g.
 * `website_k3x9qa`, that isn't one of `takenNames`. `random` stands in for
 * `Str::random()` (tests pass a sequence, as Pest's
 * `Str::createRandomStringsUsingSequence()` does).
 */
export function generateHoneypotName(
  takenNames: readonly string[] = [],
  random: (length: number) => string = strRandom,
): string {
  for (;;) {
    const prefix = HONEYPOT_PREFIXES[randomInt(HONEYPOT_PREFIXES.length)];
    const name = `${prefix}_${random(6).toLowerCase()}`;
    if (!takenNames.includes(name)) return name;
  }
}
