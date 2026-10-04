import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Laravel's temporary signed routes with `absolute: false` (the export
 * download link, ch. 3 §3.7). The signature is HMAC-SHA256 over the relative
 * URL with its sorted query (`expires`), keyed with `APP_KEY` exactly as
 * configured: Laravel does not decode a `base64:` key for signing.
 */
export function signRelativeUrl(
  path: string,
  expiresAt: number,
  key: string,
): string {
  const unsigned = `${path}?expires=${expiresAt}`;
  return `${unsigned}&signature=${hmac(unsigned, key)}`;
}

export type SignatureCheck = 'valid' | 'invalid' | 'expired';

/**
 * `hasValidSignature($request, absolute: false)`: recomputes the HMAC over
 * `/path?raw query without signature` (in the order sent), compares in
 * constant time, then checks `expires` against `now` (Unix seconds).
 */
export function checkRelativeSignature(
  path: string,
  rawQuery: string,
  key: string,
  nowSeconds: number,
): SignatureCheck {
  const params = rawQuery === '' ? [] : rawQuery.split('&');
  const signatureParam = params.find((p) => p.split('=')[0] === 'signature');
  const signature =
    signatureParam === undefined
      ? undefined
      : signatureParam.slice('signature='.length);
  if (signature === undefined || signatureParam?.indexOf('=') === -1)
    return 'invalid';
  const rest = params.filter((p) => p.split('=')[0] !== 'signature').join('&');
  const original = `/${path.replace(/^\/+|\/+$/g, '')}${rest === '' ? '' : `?${rest}`}`;
  const expected = Buffer.from(hmac(original, key));
  const given = Buffer.from(decodeURIComponentSafe(signature));
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return 'invalid';

  const expires = new URLSearchParams(rawQuery).get('expires');
  if (
    expires !== null &&
    expires !== '' &&
    expires !== '0' &&
    nowSeconds > Number(expires)
  ) {
    return 'expired';
  }
  return 'valid';
}

function hmac(value: string, key: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
