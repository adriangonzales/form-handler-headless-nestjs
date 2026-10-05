import { phpString } from '../validation/php';

/** `rawurlencode()`: everything but `A-Z a-z 0-9 - _ . ~` is percent-encoded. */
export function rawUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `urlencode()`: like `rawurlencode()`, but `~` is encoded and a space is `+`. */
export function urlEncode(value: string): string {
  return rawUrlEncode(value).replace(/~/g, '%7E').replace(/%20/g, '+');
}

/**
 * `http_build_query($params, '', '&', PHP_QUERY_RFC3986)` (Laravel's
 * `Arr::query()`): nested keys as `a%5Bb%5D`, null values and empty arrays
 * omitted, booleans as `1`/`0`. `rfc1738` is PHP's default encoding
 * (`urlencode()`), as a plain `http_build_query($params)` uses.
 */
export function httpBuildQuery(
  params: Record<string, unknown>,
  encoding: 'rfc3986' | 'rfc1738' = 'rfc3986',
): string {
  const encode = encoding === 'rfc3986' ? rawUrlEncode : urlEncode;
  const parts: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      for (const [inner, innerValue] of Object.entries(value))
        walk(innerValue, `${key}[${inner}]`);
      return;
    }
    const scalar =
      typeof value === 'boolean' ? (value ? '1' : '0') : phpString(value);
    parts.push(`${encode(key)}=${encode(scalar)}`);
  };
  for (const [key, value] of Object.entries(params)) walk(value, key);
  return parts.join('&');
}
