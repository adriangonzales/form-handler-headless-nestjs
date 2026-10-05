import { randomBytes } from 'node:crypto';

/**
 * `Str::random()`: base64 of random bytes with `/`, `+` and `=` removed, so
 * only `[A-Za-z0-9]`. tymon's `jti` is `Str::random()` (16 characters).
 */
export function strRandom(length = 16): string {
  let out = '';
  while (out.length < length) {
    const size = length - out.length;
    const bytes = randomBytes(Math.ceil(size / 3) * 3);
    out += bytes.toString('base64').replace(/[/+=]/g, '').slice(0, size);
  }
  return out;
}

/** Letters NFKD can't decompose, from voku/portable-ascii's tables. */
const SPECIAL: Record<string, string> = {
  ß: 'ss',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  ł: 'l',
  Ł: 'L',
  þ: 'th',
  Þ: 'TH',
  ı: 'i',
  ħ: 'h',
  Ħ: 'H',
};

/**
 * `Str::transliterate()` (voku `ASCII::to_transliterate`, unknown → `?`),
 * approximated: decompose, drop combining marks, map the letters above, and
 * replace anything else outside ASCII with `?`. Only used to build the login
 * limiter key, which is hashed and never leaves the server, so the only
 * observable effect is which emails share a counter (ch. 5 §5.4).
 */
export function strTransliterate(value: string): string {
  let out = '';
  for (const char of value.normalize('NFKD').replace(/\p{M}/gu, '')) {
    if (char.charCodeAt(0) < 0x80) out += char;
    else out += SPECIAL[char] ?? '?';
  }
  return out;
}

/**
 * `RateLimiter::cleanRateLimiterKey()`: `htmlentities()` (ENT_QUOTES), then
 * each named entity collapsed to its first letter (`&amp;` → `a`).
 */
export function cleanRateLimiterKey(key: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return key
    .replace(/[&<>"']/g, (c) => entities[c])
    .replace(/&([a-z])[a-z]+;/gi, '$1');
}
