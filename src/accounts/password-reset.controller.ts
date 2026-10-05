import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ValidationException } from '../common/http/laravel-exceptions';
import { RateLimited } from '../common/rate-limit/rate-limited.decorator';
import { Throttler } from '../common/rate-limit/throttlers';
import { strRandom } from '../common/support/str';
import { Validated } from '../common/validation/validated.decorator';
import { PasswordHasher } from '../users/password-hasher';
import { User } from '../users/user.entity';
import { PasswordBroker } from './password-broker.service';
import {
  forgotPasswordRules,
  resetPasswordRules,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from './rules/password-reset.rules';

class MessageResponse {
  @ApiProperty()
  message!: string;
}

/**
 * `PasswordResetController` (ch. 5 §5.10). Both routes share the `password`
 * throttler's counter: 6 per minute per IP.
 */
@ApiTags('Auth')
@Controller('auth')
@RateLimited(Throttler.Password)
@ApiTooManyRequestsResponse()
export class PasswordResetController {
  constructor(
    private readonly broker: PasswordBroker,
    private readonly hasher: PasswordHasher,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Email a reset link. The response is the same whether or not the account
   * exists or the request was throttled, so emails can't be enumerated.
   */
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOkResponse({ type: MessageResponse })
  @ApiUnprocessableEntityResponse()
  async forgot(
    @Validated({ rules: forgotPasswordRules }) input: ForgotPasswordInput,
  ): Promise<MessageResponse> {
    await this.broker.sendResetLink(input.email.toLowerCase());
    return {
      message:
        'If an account exists for that email, a password reset link has been sent.',
    };
  }

  /** Set a new password from an emailed token and revoke every existing token. */
  @Post('reset-password')
  @HttpCode(200)
  @ApiOkResponse({ type: MessageResponse })
  @ApiUnprocessableEntityResponse()
  async reset(
    @Validated({ rules: resetPasswordRules }) input: ResetPasswordInput,
  ): Promise<MessageResponse> {
    const status = await this.broker.reset(
      input.email.toLowerCase(),
      input.token,
      async (user) => {
        user.password = await this.hasher.make(input.password);
        user.rememberToken = strRandom(60);
        user.tokenVersion += 1;
        await this.users.save(user);
      },
    );
    if (status !== 'reset') {
      throw ValidationException.withMessages({
        email: 'This password reset token is invalid.',
      });
    }
    return { message: 'Your password has been reset.' };
  }
}
