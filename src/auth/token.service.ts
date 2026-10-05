import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { Clock } from '../common/clock/clock';
import { strRandom } from '../common/support/str';
import { jwtConfig } from '../config';
import type { User } from '../users/user.entity';

/** tymon's `lock_subject`: `sha1(get_class($user))`. */
export const USER_PRV = createHash('sha1')
  .update('App\\Models\\User')
  .digest('hex');

/** tymon's claim set (ch. 5 §5.2), in tymon's order. */
export interface TokenClaims {
  iss: string;
  iat: number;
  exp: number;
  nbf: number;
  jti: string;
  sub: string;
  prv?: string;
  tv?: number;
  [claim: string]: unknown;
}

export interface IssuedToken {
  token: string;
  claims: TokenClaims;
}

/** Any reason a token can't be used. Always rendered as 401 "Unauthenticated.". */
export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidTokenError';
  }
}

/**
 * - `payload`: a normal authenticated request (`exp`, `nbf`, `iat`).
 * - `refresh`: tymon's refresh flow; `exp` and `nbf` are ignored, and the
 *   token must be no older than `iat + JWT_REFRESH_TTL`.
 */
export type DecodeMode = 'payload' | 'refresh';

const REQUIRED = ['iss', 'iat', 'exp', 'nbf', 'sub', 'jti'] as const;
const DATES = ['iat', 'exp', 'nbf'] as const;

/**
 * Signs and checks tymon-compatible tokens (HS256). All time comes from the
 * `Clock`, so `jsonwebtoken`'s own time checks are switched off and redone
 * here with tymon's rules (no leeway).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly clock: Clock,
    @Inject(jwtConfig.KEY)
    private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  /** `expires_in` in the token response: the TTL in seconds. */
  get ttlSeconds(): number {
    return this.config.ttl * 60;
  }

  get refreshTtlMinutes(): number {
    return this.config.refreshTtl;
  }

  /** `auth('api')->login($user)`: `iss` is the URL of the issuing request. */
  issue(user: User, issuer: string): Promise<IssuedToken> {
    return this.sign({
      iss: issuer,
      sub: String(user.id),
      prv: USER_PRV,
      tv: user.tokenVersion,
    });
  }

  /**
   * The token a refresh issues: fresh `iss`, `exp`, `nbf` and `jti`, with the
   * original `iat`, `sub`, `prv` and `tv` carried over.
   */
  refreshed(old: TokenClaims, issuer: string): Promise<IssuedToken> {
    const carried: Partial<TokenClaims> = {
      iss: issuer,
      iat: old.iat,
      sub: old.sub,
    };
    if (old.prv !== undefined) carried.prv = old.prv;
    if (old.tv !== undefined) carried.tv = old.tv;
    return this.sign(carried);
  }

  async decode(token: string, mode: DecodeMode): Promise<TokenClaims> {
    assertStructure(token);

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        ignoreExpiration: true,
        ignoreNotBefore: true,
      });
    } catch {
      throw new InvalidTokenError('Token Signature could not be verified.');
    }
    if (typeof payload !== 'object' || payload === null)
      throw new InvalidTokenError('Malformed payload');

    const claims = payload as Record<string, unknown>;
    for (const name of REQUIRED) {
      if (claims[name] === undefined || claims[name] === null)
        throw new InvalidTokenError(
          'JWT payload does not contain the required claims',
        );
    }
    for (const name of DATES) {
      if (typeof claims[name] !== 'number' || !Number.isFinite(claims[name]))
        throw new InvalidTokenError(
          `Invalid value provided for claim [${name}]`,
        );
    }

    const now = this.nowSeconds();
    const { iat, exp, nbf } = claims as {
      iat: number;
      exp: number;
      nbf: number;
    };
    // IssuedAt::validateCreate runs in both modes.
    if (iat > now)
      throw new InvalidTokenError(
        'Issued At (iat) timestamp cannot be in the future',
      );
    if (mode === 'payload') {
      if (exp < now) throw new InvalidTokenError('Token has expired');
      if (nbf > now)
        throw new InvalidTokenError(
          'Not Before (nbf) timestamp cannot be in the future',
        );
    } else if (iat + this.config.refreshTtl * 60 < now) {
      throw new InvalidTokenError(
        'Token has expired and can no longer be refreshed',
      );
    }

    return { ...claims, sub: String(claims.sub) } as TokenClaims;
  }

  nowSeconds(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  private async sign(custom: Partial<TokenClaims>): Promise<IssuedToken> {
    const now = this.nowSeconds();
    const claims: TokenClaims = {
      iss: '',
      iat: now,
      exp: now + this.config.ttl * 60,
      nbf: now,
      jti: strRandom(16),
      sub: '',
      ...custom,
    };
    const token = await this.jwt.signAsync(claims, { algorithm: 'HS256' });
    return { token, claims };
  }
}

/** tymon's `TokenValidator`: three non-empty, untrimmed segments. */
function assertStructure(token: string): void {
  const parts = token.split('.');
  if (parts.length !== 3)
    throw new InvalidTokenError('Wrong number of segments');
  if (parts.some((part) => part.trim() === '' || part.trim() !== part))
    throw new InvalidTokenError('Malformed token');
}
