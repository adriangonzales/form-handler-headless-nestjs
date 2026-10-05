import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { requestUrl } from '../common/http/paginate';
import { clientIp } from '../common/http/trust-proxy';
import { Validated } from '../common/validation/validated.decorator';
import { userResource, UserResponse } from '../users/user.resource';
import type { User } from '../users/user.entity';
import {
  Authenticated,
  CurrentToken,
  CurrentUser,
  type AuthContext,
} from './auth.guards';
import { AuthService } from './auth.service';
import { loginRules, type LoginInput } from './rules/login.rules';
import { TokenResponse } from './token-response';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Exchange an email and password for an access token. */
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnprocessableEntityResponse()
  @ApiTooManyRequestsResponse()
  login(
    @Validated({ rules: loginRules }) input: LoginInput,
    @Req() req: Request,
  ): Promise<TokenResponse> {
    return this.auth.login(input, clientIp(req), requestUrl(req));
  }

  /** Exchange a current or recently expired token for a new one. */
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnauthorizedResponse()
  refresh(@Req() req: Request): Promise<TokenResponse> {
    return this.auth.refresh(req);
  }

  /** Invalidate the current token. */
  @Post('logout')
  @HttpCode(204)
  @Authenticated()
  @ApiNoContentResponse()
  async logout(@CurrentToken() auth: AuthContext): Promise<void> {
    await this.auth.logout(auth);
  }

  /** Get the authenticated user. */
  @Get('me')
  @Authenticated()
  @ApiOkResponse({ type: UserResponse })
  me(@CurrentUser() user: User): UserResponse {
    return userResource(user);
  }
}
