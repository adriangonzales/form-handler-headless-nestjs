import { PasswordHasher } from './password-hasher';

describe('PasswordHasher (BcryptHasher)', () => {
  const hasher = new PasswordHasher({ bcryptRounds: 4 } as never);

  it('verifies real $2y$ hashes written by PHP (Laravel cost 12 and test cost 4)', async () => {
    // php -r 'echo password_hash("correct-horse-battery-staple", PASSWORD_BCRYPT);'
    const cost12 =
      '$2y$12$22VUHLRK1WmxOLg1QqcJ0eRBHKdu20Ioz5WNsYMfOO8hEc2PiVGAu';
    const cost4 =
      '$2y$04$q/Ox1OBZjc3kHzuW1WufkOEkaSgqRhaGBtLRNS5R5QU9fqEhARB2u';
    for (const hash of [cost12, cost4]) {
      expect(await hasher.check('correct-horse-battery-staple', hash)).toBe(
        true,
      );
      expect(await hasher.check('wrong', hash)).toBe(false);
    }
  });

  it('hashes with the configured cost and verifies its own hashes', async () => {
    const hash = await hasher.make('secret');
    expect(hash).toMatch(/^\$2b\$04\$/);
    expect(await hasher.check('secret', hash)).toBe(true);
  });

  it('rejects empty and non-bcrypt hashes', async () => {
    for (const hash of [
      null,
      undefined,
      '',
      'plain-text',
      '$argon2id$v=19$x',
    ]) {
      expect(await hasher.check('secret', hash)).toBe(false);
    }
  });
});
