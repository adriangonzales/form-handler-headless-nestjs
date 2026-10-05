import { DataSource, Not } from 'typeorm';
import { authContext } from '../../auth/auth.guards';
import { mergeInput } from '../../common/http/request-input';
import type { ValidationRequestContext } from '../../common/validation/validated.decorator';
import type { RuleObject, RuleSet } from '../../common/validation/validator';
import { PasswordHasher } from '../../users/password-hasher';
import { PasswordPolicy } from '../../users/password-policy';
import { User } from '../../users/user.entity';

/** `current_password:api`: the authenticated user's password. */
function currentPassword(ctx: ValidationRequestContext): RuleObject {
  return {
    name: 'current_password',
    check: (value) =>
      ctx
        .resolve(PasswordHasher)
        .check(String(value), authContext(ctx.req).user.password),
  };
}

/** `Rule::unique('users', 'email')->ignore($user->id)`. */
function uniqueEmailExcept(ctx: ValidationRequestContext): RuleObject {
  return {
    name: 'unique',
    check: async (value) =>
      !(await ctx
        .resolve(DataSource)
        .getRepository(User)
        .existsBy({
          email: String(value),
          id: Not(authContext(ctx.req).user.id),
        })),
  };
}

/** `UpdateProfileRequest::prepareForValidation()`: emails are stored lowercased. */
export function lowercaseEmail({ req, input }: ValidationRequestContext): void {
  if (typeof input.email === 'string')
    mergeInput(req, { email: input.email.toLowerCase() });
}

/** `UpdateProfileRequest::rules()`. */
export function updateProfileRules(ctx: ValidationRequestContext): RuleSet {
  return {
    name: ['sometimes', 'required', 'string', 'max:255'],
    email: [
      'sometimes',
      'required',
      'string',
      'email',
      'max:255',
      uniqueEmailExcept(ctx),
    ],
  };
}

export interface UpdateProfileInput {
  name?: string;
  email?: string;
}

/** `UpdatePasswordRequest::rules()`. */
export function updatePasswordRules(ctx: ValidationRequestContext): RuleSet {
  return {
    current_password: ['required', 'string', currentPassword(ctx)],
    password: [
      'required',
      'string',
      'confirmed',
      'different:current_password',
      ctx.resolve(PasswordPolicy).rule(),
    ],
  };
}

export interface UpdatePasswordInput {
  current_password: string;
  password: string;
}

/** `DeleteAccountRequest::rules()`. */
export function deleteAccountRules(ctx: ValidationRequestContext): RuleSet {
  return { password: ['required', 'string', currentPassword(ctx)] };
}
