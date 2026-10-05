import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { compare, hash } from 'bcrypt';
import { appConfig } from '../config';

/** A bcrypt hash in any of the `$2a$` / `$2b$` / `$2y$` variants. */
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value: string): boolean {
  return BCRYPT.test(value);
}

/**
 * Laravel's `BcryptHasher` (ch. 5 §5.8). PHP writes `$2y$`, which is the same
 * algorithm as `$2b$`; the `bcrypt` package rejects the `y` prefix, so it is
 * rewritten before comparing.
 */
@Injectable()
export class PasswordHasher {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  make(plain: string): Promise<string> {
    return hash(plain, this.config.bcryptRounds);
  }

  /** `Hash::check()`: false for an empty or non-bcrypt hash. */
  async check(
    plain: string,
    hashed: string | null | undefined,
  ): Promise<boolean> {
    if (!hashed || !isBcryptHash(hashed)) return false;
    return compare(plain, hashed.replace(/^\$2y\$/, '$2b$'));
  }
}
