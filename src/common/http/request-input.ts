import type { Request } from 'express';
import { isPlainObject } from '../validation/php';

/**
 * Laravel's input preparation (ch. 3 §3.2, _Request input_): `TrimStrings`
 * then `ConvertEmptyStringsToNull` on the query string and the body, and
 * `$request->all()` for validation. Read input through `requestInput()`,
 * never `req.body` / `req.query` directly.
 */
export interface PreparedInput {
  /** `$request->query()`. */
  query: Record<string, unknown>;
  /** The input source: the JSON body, the query string for GET/HEAD, else the form body. */
  source: Record<string, unknown>;
  /** `$request->all()`: the source plus query keys it doesn't have. */
  all: Record<string, unknown>;
}

/** `TrimStrings::$except`: matched against the full dotted key. */
const NEVER_TRIM = new Set([
  'current_password',
  'password',
  'password_confirmation',
]);

/**
 * `Str::trim()`: PCRE `\s` in Unicode mode (which, unlike JS, includes
 * U+0085) plus Laravel's invisible characters and NUL.
 */
const INVISIBLE =
  '\\u0009\\u0020\\u00A0\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u2000-\\u200F\\u202F\\u205F\\u2060-\\u2065\\u206A-\\u206F\\u3000\\u2800\\u3164\\uFEFF\\uFFA0\\u{1D159}\\u{1D173}-\\u{1D17A}\\u{E0020}';
const TRIM = new RegExp(
  // The class deliberately lists combining and invisible characters (U+034F…).
  // eslint-disable-next-line no-misleading-character-class
  `^[\\s\\u0085\\0${INVISIBLE}]+|[\\s\\u0085\\0${INVISIBLE}]+$`,
  'gu',
);

export function strTrim(value: string): string {
  return value.replace(TRIM, '');
}

function clean(value: unknown, key: string): unknown {
  if (Array.isArray(value))
    return value.map((inner, i) => clean(inner, `${key}.${i}`));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(value))
      out[k] = clean(inner, `${key}.${k}`);
    return out;
  }
  if (typeof value !== 'string') return value;
  const trimmed = NEVER_TRIM.has(key) ? value : strTrim(value);
  return trimmed === '' ? null : trimmed;
}

/** Applies both middleware to a top-level input bag. */
export function cleanInput(
  bag: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) out[key] = clean(value, key);
  return out;
}

/** A top-level bag as an object (PHP lists at the top level keep index keys). */
export function asBag(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { ...value };
  return isPlainObject(value) ? value : {};
}

/** Laravel's `Request::isJson()`. */
export function isJsonRequest(req: { headers: Request['headers'] }): boolean {
  const type = req.headers['content-type'] ?? '';
  return type.includes('/json') || type.includes('+json');
}

const prepared = new WeakMap<Request, PreparedInput>();

export function requestInput(req: Request): PreparedInput {
  const cached = prepared.get(req);
  if (cached) return cached;

  const query = cleanInput(asBag(req.query));
  const body = cleanInput(asBag(req.body));
  const source = isJsonRequest(req)
    ? body
    : ['GET', 'HEAD'].includes(req.method)
      ? query
      : body;
  const all: Record<string, unknown> = { ...source };
  for (const [key, value] of Object.entries(query)) {
    if (!(key in all)) all[key] = value;
  }

  const input = { query, source, all };
  prepared.set(req, input);
  return input;
}

/** `$request->merge()`: later reads (and validation) see the merged values. */
export function mergeInput(
  req: Request,
  values: Record<string, unknown>,
): void {
  const input = requestInput(req);
  Object.assign(input.source, values);
  Object.assign(input.all, values);
}
