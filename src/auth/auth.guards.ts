import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthenticationException } from '../common/http/laravel-exceptions';
import { User } from '../users/user.entity';
import { DenyListService } from './deny-list.service';
import { extractToken } from './token-extractor';
import {
  InvalidTokenError,
  TokenService,
  USER_PRV,
  type DecodeMode,
  type TokenClaims,
} from './token.service';

/** What `JwtAuthGuard` attaches to the request. */
export interface AuthContext {
  user: User;
  token: string;
  claims: TokenClaims;
}

const contexts = new WeakMap<Request, AuthContext>();

export function authContext(req: Request): AuthContext {
  const context = contexts.get(req);
  if (!context) throw new Error('No authenticated user on this request');
  return context;
}

/**
 * Reads and checks the request's token: signature, claims, deny list.
 * Shared by the guard and the refresh endpoint (which uses `refresh` mode).
 */
@Injectable()
export class TokenAuthenticator {
  constructor(
    private readonly tokens: TokenService,
    private readonly denyList: DenyListService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** The request's token and its checked claims; throws `InvalidTokenError`. */
  async verify(
    req: Request,
    mode: DecodeMode,
  ): Promise<{ token: string; claims: TokenClaims }> {
    const token = extractToken(req);
    if (token === null) throw new InvalidTokenError('Token not provided');
    const claims = await this.tokens.decode(token, mode);
    if (await this.denyList.isDenied(claims.jti))
      throw new InvalidTokenError('The token has been blacklisted');
    return { token, claims };
  }

  /** `User::find($sub)`: integer IDs only. */
  findUser(sub: string): Promise<User | null> {
    if (!/^\d+$/.test(sub)) return Promise.resolve(null);
    const id = Number(sub);
    if (!Number.isSafeInteger(id)) return Promise.resolve(null);
    return this.users.findOneBy({ id });
  }
}

/**
 * `auth:api` (ch. 5 §5.12): a valid, non-denied token whose `prv` (when
 * present) is the user model's, for a user that still exists.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authenticator: TokenAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    try {
      const { token, claims } = await this.authenticator.verify(req, 'payload');
      if (claims.prv !== undefined && claims.prv !== USER_PRV)
        throw new InvalidTokenError('Wrong subject model');
      const user = await this.authenticator.findUser(claims.sub);
      if (user === null) throw new InvalidTokenError('User not found');
      contexts.set(req, { user, token, claims });
      return true;
    } catch (error) {
      if (error instanceof InvalidTokenError)
        throw new AuthenticationException();
      throw error;
    }
  }
}

/**
 * `token.current` (ch. 5 §5.6): rejects a token whose `tv` (0 when absent)
 * is behind the user's `token_version`.
 */
@Injectable()
export class TokenVersionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user, claims } = authContext(
      context.switchToHttp().getRequest<Request>(),
    );
    if (tokenIsRevoked(user, claims.tv)) throw new AuthenticationException();
    return true;
  }
}

/** `User::tokenIsRevoked()`. */
export function tokenIsRevoked(user: User, tv: unknown): boolean {
  return (tv ?? 0) !== user.tokenVersion;
}

/** `['auth:api', 'token.current']` on a controller or route. */
export function Authenticated(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    UseGuards(JwtAuthGuard, TokenVersionGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Unauthenticated.' }),
  );
}

/** `$request->user()` on an `@Authenticated()` route. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User =>
    authContext(ctx.switchToHttp().getRequest<Request>()).user,
);

/** The verified token and claims of an `@Authenticated()` request. */
export const CurrentToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext =>
    authContext(ctx.switchToHttp().getRequest<Request>()),
);
