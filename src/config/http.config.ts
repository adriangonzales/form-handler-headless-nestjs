import { registerAs } from '@nestjs/config';
import {
  parseTrustedProxies,
  TrustedProxies,
} from '../common/http/trust-proxy';
import { EnvReader, readOrThrow } from './env';

export interface HttpConfig {
  port: number;
  /** Largest accepted request body, in bytes (PHP `post_max_size`). */
  bodyLimit: number;
  trustedProxies: TrustedProxies;
}

export function readHttpConfig(r: EnvReader): HttpConfig {
  const proxies = parseTrustedProxies(r.optional('TRUSTED_PROXIES', ''));
  if ('error' in proxies) r.fail(`TRUSTED_PROXIES: ${proxies.error}`);

  return {
    port: r.int('PORT', 8000, 1),
    bodyLimit: r.size('BODY_LIMIT', '2mb'),
    trustedProxies: 'error' in proxies ? { kind: 'none' } : proxies,
  };
}

export const httpConfig = registerAs('http', () =>
  readOrThrow(process.env, readHttpConfig),
);
