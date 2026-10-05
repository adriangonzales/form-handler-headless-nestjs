import { Controller, Delete, HttpCode, Patch, Put, Req } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  Authenticated,
  CurrentToken,
  type AuthContext,
} from '../auth/auth.guards';
import { TokenResponse } from '../auth/token-response';
import { requestUrl } from '../common/http/paginate';
import { Validated } from '../common/validation/validated.decorator';
import { userResource, UserResponse } from '../users/user.resource';
import { AccountsService } from './accounts.service';
import {
  deleteAccountRules,
  lowercaseEmail,
  updatePasswordRules,
  updateProfileRules,
  type UpdatePasswordInput,
  type UpdateProfileInput,
} from './rules/account.rules';

/** `AccountController` (ch. 5 §5.7). */
@ApiTags('Auth')
@Controller('auth')
@Authenticated()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** Update the name or email. Changing the email clears its verification. */
  @Patch('me')
  @ApiOkResponse({ type: UserResponse })
  @ApiUnprocessableEntityResponse()
  async update(
    @CurrentToken() auth: AuthContext,
    @Validated({ prepare: lowercaseEmail, rules: updateProfileRules })
    input: UpdateProfileInput,
  ): Promise<UserResponse> {
    return userResource(await this.accounts.updateProfile(auth.user, input));
  }

  /** Change the password, revoke every existing token, and return a new one. */
  @Put('password')
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnprocessableEntityResponse()
  updatePassword(
    @CurrentToken() auth: AuthContext,
    @Validated({ rules: updatePasswordRules }) input: UpdatePasswordInput,
    @Req() req: Request,
  ): Promise<TokenResponse> {
    return this.accounts.updatePassword(auth, input.password, requestUrl(req));
  }

  /** Permanently delete the account and everything it owns. */
  @Delete('me')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiUnprocessableEntityResponse()
  async destroy(
    @Validated({ rules: deleteAccountRules }) _input: unknown,
    @CurrentToken() auth: AuthContext,
  ): Promise<void> {
    await this.accounts.deleteAccount(auth);
  }
}
