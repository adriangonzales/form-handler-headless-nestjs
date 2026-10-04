/**
 * PHP semantics the validation engine and input preparation rely on. Each
 * helper names the PHP function it ports; the PHP-generated corpus in
 * `test/fixtures/validation` pins the behaviour.
 */

export type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** PHP `is_array()`: JSON arrays and objects both decode to PHP arrays. */
export function isPhpArray(value: unknown): value is unknown[] | PlainObject {
  return Array.isArray(value) || isPlainObject(value);
}

/** PHP `count()` for arrays. */
export function phpCount(value: unknown[] | PlainObject): number {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

/** `array_is_list()`. Objects only qualify with keys `0..n-1` in order. */
export function isList(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key, index) => key === String(index));
}

/** PHP `trim()` with its default ASCII character list. */
export function phpTrim(value: string): string {
  return value.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '');
}

/** `(string) $value` for scalars. */
export function phpString(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value === true) return '1';
  if (typeof value === 'number') return phpNumberString(value);
  if (typeof value === 'string') return value;
  return 'Array';
}

/** PHP's float-to-string conversion (shortest round trip, `1.0E+25` style). */
export function phpNumberString(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  if (!Number.isFinite(value))
    return value > 0 ? 'INF' : value < 0 ? '-INF' : 'NAN';
  const text = String(value);
  const exp = /^(-?[\d.]+)e([+-])(\d+)$/.exec(text);
  if (!exp) return text;
  const mantissa = exp[1].includes('.') ? exp[1] : `${exp[1]}.0`;
  return `${mantissa}E${exp[2]}${exp[3]}`;
}

/** `mb_strlen()`: Unicode code points. */
export function mbStrlen(value: string): number {
  return [...value].length;
}

const NUMERIC =
  /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/;

/** `is_numeric()`: leading and trailing whitespace allowed, no hex, no `_`. */
export function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && NUMERIC.test(value);
}

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;

/**
 * `filter_var($value, FILTER_VALIDATE_INT) !== false`: optional sign, no
 * leading zeros, surrounding whitespace allowed, 64-bit range. Booleans and
 * whole floats are converted to strings first, as PHP does.
 */
export function isFilterInt(value: unknown): boolean {
  if (typeof value === 'number') return Number.isInteger(value);
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  const match = /^[ \t\n\r\v]*([+-]?)(0|[1-9]\d*)[ \t\n\r\v]*$/.exec(value);
  if (!match) return false;
  const n = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}`);
  return n >= INT_MIN && n <= INT_MAX;
}

/** A numeric string or number as a JS number (`is_numeric` values only). */
export function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(String(value).trim());
}

/**
 * PHP 8 loose comparison (`==`) for the scalar cases `in_array()` and
 * `distinct` meet: numeric strings compare as numbers, other strings with
 * numbers compare as strings, booleans and null coerce.
 */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return looseEqualsNull(b);
  if (b === null || b === undefined) return looseEqualsNull(a);
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return toBool(a) === toBool(b);
  }
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'number' || typeof b === 'number') {
    const other = typeof a === 'number' ? b : a;
    const num = typeof a === 'number' ? a : (b as number);
    if (typeof other === 'string') {
      return isNumeric(other)
        ? toNumber(other) === num
        : other === phpString(num);
    }
    return false;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return isNumeric(a) && isNumeric(b) ? toNumber(a) === toNumber(b) : a === b;
  }
  if (isPhpArray(a) && isPhpArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every(
        (k) =>
          k in b && looseEquals((a as PlainObject)[k], (b as PlainObject)[k]),
      )
    );
  }
  return false;
}

function looseEqualsNull(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === false ||
    value === '' ||
    (isPhpArray(value) && phpCount(value) === 0)
  );
}

function toBool(value: unknown): boolean {
  if (typeof value === 'string') return value !== '' && value !== '0';
  if (typeof value === 'number') return value !== 0;
  if (isPhpArray(value)) return phpCount(value) > 0;
  return Boolean(value);
}

/**
 * `Str::snake()` with the default `_` delimiter: words in mixed case are
 * split before each uppercase letter, so `firstName` → `first_name` and a
 * ULID `01K6B6…` → `01_k6_b6…`.
 */
export function strSnake(value: string): string {
  if (/^[a-z]+$/.test(value)) return value; // ctype_lower
  const words = value.replace(
    /(^|[ \t\r\n\f\v])(\S)/g,
    (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
  );
  const compact = words.replace(/\s+/gu, '');
  return compact.replace(/(.)(?=\p{Lu})/gu, '$1_').toLowerCase();
}

/** `str_getcsv($value, escape: '\\')` for rule parameters such as `in:"a,b",c`. */
export function strGetCsv(value: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  let fieldStart = true;
  while (i < value.length) {
    const ch = value[i];
    if (quoted) {
      if (ch === '\\' && i + 1 < value.length) {
        field += ch + value[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        if (value[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      i++;
      continue;
    }
    if (ch === ',') {
      out.push(field);
      field = '';
      fieldStart = true;
      i++;
      continue;
    }
    field += ch;
    fieldStart = false;
    i++;
  }
  out.push(field);
  return out;
}

/**
 * The shape `json_decode($json, true)` gives: objects whose keys are exactly
 * `0..n-1` in order (including `{}`) become lists, recursively. Input is
 * normalised this way so validation and stored values match Laravel.
 */
export function toPhpShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPhpShape);
  if (!isPlainObject(value)) return value;
  const entries = Object.entries(value).map(
    ([k, v]) => [k, toPhpShape(v)] as const,
  );
  if (entries.every(([key], index) => key === String(index))) {
    return entries.map(([, v]) => v);
  }
  return Object.fromEntries(entries);
}
