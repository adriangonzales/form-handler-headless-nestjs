import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import {
  AuthenticationException,
  ValidationException,
} from '../common/http/laravel-exceptions';
import { requestUrl } from '../common/http/paginate';
import { PasswordHasher } from '../users/password-hasher';
import { User } from '../users/user.entity';
import {
  TokenAuthenticator,
  tokenIsRevoked,
  type AuthContext,
} from './auth.guards';
import { DenyListService } from './deny-list.service';
import { LoginLimiter } from './login-limiter.service';
import type { LoginInput } from './rules/login.rules';
import { tokenResponse, type TokenResponse } from './token-response';
import { InvalidTokenError, TokenService } from './token.service';

/** `AuthController` (ch. 5 §5.3). */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly denyList: DenyListService,
    private readonly limiter: LoginLimiter,
    private readonly authenticator: TokenAuthenticator,
  ) {}

  /**
   * Throttle check, then credentials. Only failures are counted (5 per
   * minute per email and IP); a success clears the count.
   */
  async login(
    input: LoginInput,
    ip: string,
    issuer: string,
  ): Promise<TokenResponse> {
    const email = input.email.toLowerCase();
    const key = this.limiter.key(email, ip);

    if (await this.limiter.tooManyAttempts(key)) {
      const seconds = await this.limiter.availableIn(key);
      throw ValidationException.withMessages(
        {
          email: `Too many login attempts. Please try again in ${seconds} seconds.`,
        },
        429,
      );
    }

    const user = await this.users.findOneBy({ email });
    if (
      user === null ||
      !(await this.hasher.check(input.password, user.password))
    ) {
      await this.limiter.hit(key);
      throw ValidationException.withMessages({
        email: 'These credentials do not match our records.',
      });
    }

    await this.limiter.clear(key);
    return this.issue(user, issuer);
  }

  /**
   * tymon's refresh: the old token is checked in refresh mode (expiry
   * ignored, `iat` within `JWT_REFRESH_TTL`) and denied, and a new one keeps
   * its `iat`, `sub` and `tv`. Only then is revocation checked; a revoked or
   * orphaned refresh denies the new token too.
   */
  async refresh(req: Request): Promise<TokenResponse> {
    let issued;
    try {
      const { claims } = await this.authenticator.verify(req, 'refresh');
      issued = await this.tokens.refreshed(claims, requestUrl(req));
      await this.denyList.add(claims);
    } catch (error) {
      if (error instanceof InvalidTokenError)
        throw new AuthenticationException();
      throw error;
    }

    const user = await this.authenticator.findUser(issued.claims.sub);
    if (user === null || tokenIsRevoked(user, issued.claims.tv)) {
      await this.denyList.add(issued.claims);
      throw new AuthenticationException();
    }

    return tokenResponse(issued.token, this.tokens.ttlSeconds);
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.denyList.add(auth.claims);
  }

  /** `auth('api')->login($user)` in the token response shape. */
  async issue(user: User, issuer: string): Promise<TokenResponse> {
    const { token } = await this.tokens.issue(user, issuer);
    return tokenResponse(token, this.tokens.ttlSeconds);
  }
}
