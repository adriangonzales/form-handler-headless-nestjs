import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthContext } from '../auth/auth.guards';
import { AuthService } from '../auth/auth.service';
import { DenyListService } from '../auth/deny-list.service';
import type { TokenResponse } from '../auth/token-response';
import { PasswordHasher } from '../users/password-hasher';
import { User } from '../users/user.entity';
import { DeleteAccount } from './delete-account.service';
import type { UpdateProfileInput } from './rules/account.rules';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly hasher: PasswordHasher,
    private readonly denyList: DenyListService,
    private readonly auth: AuthService,
    private readonly deleteAccountAction: DeleteAccount,
  ) {}

  async updateProfile(user: User, input: UpdateProfileInput): Promise<User> {
    if (input.name !== undefined) user.name = input.name;
    if (input.email !== undefined && input.email !== user.email) {
      user.email = input.email;
      user.emailVerifiedAt = null;
    }
    return this.users.save(user);
  }

  /**
   * Saves the new hash and bumps `token_version` (revoking every token),
   * denies the presented token, and issues a fresh one with the new `tv`.
   */
  async updatePassword(
    auth: AuthContext,
    password: string,
    issuer: string,
  ): Promise<TokenResponse> {
    const { user } = auth;
    user.password = await this.hasher.make(password);
    user.tokenVersion += 1;
    await this.users.save(user);
    await this.denyList.add(auth.claims);
    return this.auth.issue(user, issuer);
  }

  async deleteAccount(auth: AuthContext): Promise<void> {
    await this.denyList.add(auth.claims);
    await this.deleteAccountAction.execute(auth.user);
  }
}
