import type { ValidationRequestContext } from '../../common/validation/validated.decorator';
import type { RuleSet } from '../../common/validation/validator';
import { PasswordPolicy } from '../../users/password-policy';

/** `ForgotPasswordRequest::rules()`. */
export const forgotPasswordRules: RuleSet = {
  email: ['required', 'string', 'email'],
};

export interface ForgotPasswordInput {
  email: string;
}

/** `ResetPasswordRequest::rules()`. */
export function resetPasswordRules(ctx: ValidationRequestContext): RuleSet {
  return {
    token: ['required', 'string'],
    email: ['required', 'string', 'email'],
    password: [
      'required',
      'string',
      'confirmed',
      ctx.resolve(PasswordPolicy).rule(),
    ],
  };
}

export interface ResetPasswordInput {
  token: string;
  email: string;
  password: string;
}
