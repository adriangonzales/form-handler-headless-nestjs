import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { FormsModule } from '../forms/forms.module';

/**
 * Feature modules served under `/api/v1`. `RouterModule` prefixes only the
 * modules it's given, so `AppModule` registers these as `children`.
 */
export const API_V1_MODULES = [AuthModule, AccountsModule, FormsModule];

/** Everything under `/api/v1`, mounted by `RouterModule` in `AppModule`. */
@Module({ imports: API_V1_MODULES })
export class ApiV1Module {}
