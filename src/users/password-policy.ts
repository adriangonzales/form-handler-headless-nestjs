import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { nestedTemplate } from '../common/validation/messages';
import { validate, type RuleObject } from '../common/validation/validator';
import { appConfig } from '../config';

/**
 * Laravel's `NotPwnedVerifier`: the Have I Been Pwned range API with
 * k-anonymity (only the first 5 hex characters of the SHA-1 are sent). If the
 * API can't be reached, the password counts as **not** compromised.
 */
@Injectable()
export class PwnedPasswords {
  private readonly logger = new Logger(PwnedPasswords.name);
  /** Replaceable in tests. */
  fetchFn: typeof fetch = (...args) => fetch(...args);
  timeoutMs = 30_000;

  /** True when the password hasn't appeared in more than `threshold` breaches. */
  async uncompromised(value: string, threshold = 0): Promise<boolean> {
    if (value === '' || value === '0') return false; // PHP empty()
    const hash = createHash('sha1').update(value).digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);

    let body = '';
    try {
      const res = await this.fetchFn(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        {
          headers: { 'Add-Padding': 'true' },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (res.ok) body = await res.text();
    } catch (error) {
      this.logger.warn(`Pwned Passwords lookup failed: ${String(error)}`);
    }

    return !body
      .trim()
      .split('\n')
      .filter((line) => line.includes(':'))
      .some((line) => {
        const [suffix, count] = line.split(':');
        return prefix + suffix === hash && Number(count) > threshold;
      });
  }
}

export interface PasswordPolicyOptions {
  min: number;
  mixedCase?: boolean;
  letters?: boolean;
  numbers?: boolean;
  symbols?: boolean;
  uncompromised?: boolean;
}

/** `Password::defaults()` (ch. 5 §5.9): strict in production, `min(8)` elsewhere. */
export function defaultPasswordPolicy(env: string): PasswordPolicyOptions {
  return env === 'production'
    ? {
        min: 12,
        mixedCase: true,
        letters: true,
        numbers: true,
        symbols: true,
        uncompromised: true,
      }
    : { min: 8 };
}

/**
 * `Illuminate\Validation\Rules\Password`: `string` and `min` run as a nested
 * validation, then the character-class checks (all reported together, in
 * Laravel's order), and the breach check only once everything else passes.
 */
export function passwordRule(
  options: PasswordPolicyOptions,
  pwned: PwnedPasswords,
): RuleObject {
  return {
    name: 'password',
    async check(value, attribute, context) {
      const inner = await validate(
        { [attribute]: ['string', `min:${options.min}`] },
        context.data,
      );
      const messages = [...(inner.errors.get(attribute) ?? [])];

      if (typeof value === 'string') {
        const checks: [boolean | undefined, RegExp, string][] = [
          [options.mixedCase, /(\p{Ll}+.*\p{Lu})|(\p{Lu}+.*\p{Ll})/u, 'mixed'],
          [options.letters, /\p{L}/u, 'letters'],
          [options.symbols, /\p{Z}|\p{S}|\p{P}/u, 'symbols'],
          [options.numbers, /\p{N}/u, 'numbers'],
        ];
        for (const [enabled, pattern, key] of checks) {
          if (enabled && !pattern.test(value))
            messages.push(passwordTemplate(key));
        }
      }
      if (messages.length > 0) return messages;

      if (
        options.uncompromised &&
        !(await pwned.uncompromised(String(value)))
      ) {
        return [passwordTemplate('uncompromised')];
      }
      return true;
    },
  };
}

function passwordTemplate(key: string): string {
  return nestedTemplate('password', key);
}

/** The configured `Password::defaults()` rule. */
@Injectable()
export class PasswordPolicy {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly pwned: PwnedPasswords,
  ) {}

  rule(): RuleObject {
    return passwordRule(defaultPasswordPolicy(this.config.env), this.pwned);
  }
}
