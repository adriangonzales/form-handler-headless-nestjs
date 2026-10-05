import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { validate } from '../common/validation/validator';
import {
  defaultPasswordPolicy,
  passwordRule,
  PwnedPasswords,
} from './password-policy';

/** A fake range API answering with the given lines. */
function pwned(lines: string[] | Error, calls: string[] = []): PwnedPasswords {
  const client = new PwnedPasswords();
  client.fetchFn = (input) => {
    calls.push(input instanceof Request ? input.url : input.toString());
    if (lines instanceof Error) return Promise.reject(lines);
    return Promise.resolve(new Response(lines.join('\r\n')));
  };
  return client;
}

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PASSWORD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

async function errors(
  value: unknown,
  env: string,
  client = pwned([]),
): Promise<string[]> {
  const result = await validate(
    {
      password: [
        'required',
        'string',
        passwordRule(defaultPasswordPolicy(env), client),
      ],
    },
    { password: value },
  );
  return result.errors.get('password') ?? [];
}

describe('Password::defaults() (ch. 5 §5.9)', () => {
  it('requires 8 characters outside production', async () => {
    expect(await errors('short', 'local')).toEqual([
      'The password field must be at least 8 characters.',
    ]);
    expect(await errors('12345678', 'local')).toEqual([]);
  });

  it('reports every failed character class in Laravel order in production', async () => {
    expect(await errors('abc', 'production')).toEqual([
      'The password field must be at least 12 characters.',
      'The password field must contain at least one uppercase and one lowercase letter.',
      'The password field must contain at least one symbol.',
      'The password field must contain at least one number.',
    ]);
    expect(await errors('123456789012', 'production')).toEqual([
      'The password field must contain at least one uppercase and one lowercase letter.',
      'The password field must contain at least one letter.',
      'The password field must contain at least one symbol.',
    ]);
  });

  it('accepts a strong password that is not in the breach list', async () => {
    const calls: string[] = [];
    expect(
      await errors('Correct-Horse-9', 'production', pwned([], calls)),
    ).toEqual([]);
    // k-anonymity: only the first 5 hex characters leave the server.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(
      /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/,
    );
  });

  it('rejects a breached password once everything else passes', async () => {
    const client = new PwnedPasswords();
    // Every check passes for this value; make the API report it.
    const value = 'Correct-Horse-9';
    const sha = createHash('sha1').update(value).digest('hex').toUpperCase();
    client.fetchFn = () =>
      Promise.resolve(new Response(`${sha.slice(5)}:3\r\nAAAA:0`));
    expect(await errors(value, 'production', client)).toEqual([
      'The given password has appeared in a data leak. Please choose a different password.',
    ]);
  });

  it('ignores padding entries with a zero count', async () => {
    const client = pwned([`${PASSWORD_SUFFIX}:0`]);
    expect(await client.uncompromised('password')).toBe(true);
    expect(
      await pwned([`${PASSWORD_SUFFIX}:5`]).uncompromised('password'),
    ).toBe(false);
  });

  it('treats an unreachable API as not compromised, as Laravel does', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await pwned(new Error('offline')).uncompromised('password')).toBe(
      true,
    );
  });
});
