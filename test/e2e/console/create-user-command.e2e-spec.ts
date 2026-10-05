import { compareSync } from 'bcrypt';
import { DataSource } from 'typeorm';
import {
  createUser,
  type CreateUserIo,
  type CreateUserOptions,
} from '../../../src/users/create-user.command';
import { PasswordHasher } from '../../../src/users/password-hasher';
import { PasswordPolicy } from '../../../src/users/password-policy';
import { User } from '../../../src/users/user.entity';
import { createApp, type TestApp } from '../../support/create-app';

/** Port of `tests/Feature/Console/CreateUserCommandTest.php` (3). */
describe('CreateUserCommandTest', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createApp();
  });

  afterEach(async () => {
    await t.close();
  });

  /** `$this->artisan('user:create', ...)` with `expectsQuestion()` answers. */
  async function artisan(
    options: CreateUserOptions,
    answers: Record<string, string> = {},
  ) {
    const asked: string[] = [];
    const output: string[] = [];
    const io: CreateUserIo = {
      ask: (question) => {
        asked.push(question);
        const answer = answers[question];
        if (answer === undefined)
          throw new Error(`Unexpected question: ${question}`);
        return Promise.resolve(answer);
      },
      info: (message) => output.push(message),
      error: (message) => output.push(message),
    };
    const code = await createUser(
      {
        dataSource: t.app.get(DataSource),
        hasher: t.app.get(PasswordHasher),
        policy: t.app.get(PasswordPolicy),
      },
      options,
      io,
    );
    return { code, asked, output };
  }

  const users = () => t.dataSource.getRepository(User);

  it('creates a user from options', async () => {
    const { code, output } = await artisan({
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      password: 'correct-horse-battery-staple',
    });
    expect(code).toBe(0);

    const [user, ...others] = await users().find();
    expect(others).toHaveLength(0);
    expect(user.name).toBe('Ada Lovelace');
    expect(user.email).toBe('ada@example.com');
    expect(compareSync('correct-horse-battery-staple', user.password)).toBe(
      true,
    );
    expect(output).toEqual([
      `Created user [ada@example.com] with ID [${user.id}].`,
    ]);
  });

  it('prompts for anything not given as an option', async () => {
    const { code, asked } = await artisan(
      { email: 'ada@example.com' },
      { Name: 'Ada Lovelace', Password: 'correct-horse-battery-staple' },
    );
    expect(code).toBe(0);
    expect(asked).toEqual(['Name', 'Password']);

    const [user, ...others] = await users().find();
    expect(others).toHaveLength(0);
    expect(user.name).toBe('Ada Lovelace');
  });

  it('refuses an email that is already registered', async () => {
    await t.factories.user({ email: 'ada@example.com' });

    const { code, output } = await artisan({
      name: 'Ada Lovelace',
      email: 'ADA@example.com',
      password: 'correct-horse-battery-staple',
    });
    expect(code).toBe(1);
    expect(output).toEqual(['The email has already been taken.']);

    expect(await users().count()).toBe(1);
  });
});
