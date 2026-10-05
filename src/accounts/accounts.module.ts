import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PasswordPolicy, PwnedPasswords } from '../users/password-policy';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { DeleteAccount } from './delete-account.service';
import { PasswordBroker } from './password-broker.service';
import { PasswordResetController } from './password-reset.controller';

/** Profile, password change, account deletion and password reset (ch. 5 §5.7–5.10). */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AccountsController, PasswordResetController],
  providers: [
    AccountsService,
    DeleteAccount,
    PasswordBroker,
    PasswordPolicy,
    PwnedPasswords,
  ],
})
export class AccountsModule {}
