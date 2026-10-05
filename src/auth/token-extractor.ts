import type { Request } from 'express';
import { requestInput } from '../common/http/request-input';

/** PHP's `trim()` default characters. */
const PHP_TRIM = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;

/** PHP truthiness for a parser result: `""` and `"0"` count as no token. */
function truthy(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value !== '0';
}

/**
 * tymon's `AuthHeaders` parser: finds `bearer` case-insensitively at its
 * **last** occurrence, takes what follows, cuts at the first `,`, and trims.
 * (`HTTP_AUTHORIZATION` / `REDIRECT_HTTP_AUTHORIZATION` are PHP server
 * variables with no Node equivalent.)
 */
export function parseAuthorizationHeader(
  header: string | undefined,
): string | null {
  if (!header) return null;
  const position = header.toLowerCase().lastIndexOf('bearer');
  if (position < 0) return null;
  const rest = header.slice(position + 'bearer'.length);
  const comma = rest.indexOf(',');
  return (comma >= 0 ? rest.slice(0, comma) : rest).replace(PHP_TRIM, '');
}

/**
 * tymon's parser chain (ch. 5 §5.2): the `Authorization` header, then
 * `?token=`, then a `token` input field (body or query); the first truthy
 * result wins. Query and input values are read after input preparation, as
 * the middleware has already run in Laravel.
 */
export function extractToken(req: Request): string | null {
  const input = requestInput(req);
  for (const candidate of [
    parseAuthorizationHeader(req.headers.authorization),
    input.query.token,
    input.all.token,
  ]) {
    if (truthy(candidate)) return candidate;
  }
  return null;
}
