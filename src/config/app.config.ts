import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

export interface AppConfig {
  url: string;
  /** `production` turns on the strict password policy (ch. 5 §5.9). */
  env: string;
  /**
   * `APP_KEY` exactly as configured. Laravel signs URLs with the raw string,
   * `base64:` prefix included (it doesn't decode it for HMAC).
   */
  key: string;
  passwordResetUrl: string;
  /** Minutes a signed export download URL stays valid. */
  exportDownloadUrlTtl: number;
  /** bcrypt cost for new hashes (`BCRYPT_ROUNDS`; tests use 4, as Laravel's phpunit.xml does). */
  bcryptRounds: number;
}

export function readAppConfig(r: EnvReader): AppConfig {
  const url = r.url('APP_URL').replace(/\/+$/, '');
  const key = r.required('APP_KEY');

  // The pg driver reads `timestamp without time zone` in the process's local
  // timezone (ch. 2 §2.1).
  const tz = r.optional('TZ', '');
  if (tz !== 'UTC') r.fail(`TZ must be "UTC", got "${tz}"`);

  return {
    url,
    env: r.optional('APP_ENV', 'production'),
    key,
    passwordResetUrl: r.url('PASSWORD_RESET_URL', `${url}/reset-password`),
    exportDownloadUrlTtl: r.int('EXPORT_DOWNLOAD_URL_TTL', 5, 1),
    bcryptRounds: r.int('BCRYPT_ROUNDS', 12, 4),
  };
}

export const appConfig = registerAs('app', () =>
  readOrThrow(process.env, readAppConfig),
);
