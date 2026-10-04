import { phpString } from '../validation/php';

/** `rawurlencode()`: everything but `A-Z a-z 0-9 - _ . ~` is percent-encoded. */
export function rawUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `http_build_query($params, '', '&', PHP_QUERY_RFC3986)` (Laravel's
 * `Arr::query()`): nested keys as `a%5Bb%5D`, null values and empty arrays
 * omitted, booleans as `1`/`0`.
 */
export function httpBuildQuery(params: Record<string, unknown>): string {
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
    parts.push(`${rawUrlEncode(key)}=${rawUrlEncode(scalar)}`);
  };
  for (const [key, value] of Object.entries(params)) walk(value, key);
  return parts.join('&');
}
