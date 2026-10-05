import type { RuleSet } from '../../common/validation/validator';

/** `LoginRequest::rules()`. */
export const loginRules: RuleSet = {
  email: ['required', 'string', 'email'],
  password: ['required', 'string'],
};

export interface LoginInput {
  email: string;
  password: string;
}
