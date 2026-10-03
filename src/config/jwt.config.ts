import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

export interface JwtConfig {
  secret: string;
  /** Token lifetime, in minutes. */
  ttl: number;
  /** Refresh window, in minutes. */
  refreshTtl: number;
}

export function readJwtConfig(r: EnvReader): JwtConfig {
  return {
    secret: r.required('JWT_SECRET'),
    ttl: r.int('JWT_TTL', 60, 1),
    refreshTtl: r.int('JWT_REFRESH_TTL', 10080, 1),
  };
}

export const jwtConfig = registerAs('jwt', () =>
  readOrThrow(process.env, readJwtConfig),
);
