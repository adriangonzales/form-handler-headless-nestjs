import { DataSource } from 'typeorm';
import { validate, type RuleObject } from '../common/validation/validator';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { User } from './user.entity';

export interface CreateUserOptions {
  name?: string;
  email?: string;
  password?: string;
}

export interface CreateUserIo {
  /** Asks until a non-empty answer is given; `secret` doesn't echo it. */
  ask(question: string, secret: boolean): Promise<string>;
  info(message: string): void;
  error(message: string): void;
}

export interface CreateUserServices {
  dataSource: DataSource;
  hasher: PasswordHasher;
  policy: PasswordPolicy;
}

/** `unique:users,email`. */
function uniqueEmail(dataSource: DataSource): RuleObject {
  return {
    name: 'unique',
    check: async (value) =>
      !(await dataSource
        .getRepository(User)
        .existsBy({ email: String(value) })),
  };
}

/**
 * Port of `php artisan user:create` (ch. 5 §5.11): prompts for any missing
 * option, lowercases the email, validates, and returns the exit code.
 */
export async function createUser(
  services: CreateUserServices,
  options: CreateUserOptions,
  io: CreateUserIo,
): Promise<number> {
  const attributes = {
    name: options.name ?? (await io.ask('Name', false)),
    email: (options.email ?? (await io.ask('Email', false))).toLowerCase(),
    password: options.password ?? (await io.ask('Password', true)),
  };

  const result = await validate(
    {
      name: ['required', 'string', 'max:255'],
      email: [
        'required',
        'string',
        'email',
        'max:255',
        uniqueEmail(services.dataSource),
      ],
      password: ['required', 'string', services.policy.rule()],
    },
    attributes,
  );
  if (!result.passes) {
    for (const message of [...result.errors.values()].flat()) io.error(message);
    return 1;
  }

  const user = await services.dataSource.getRepository(User).save(
    services.dataSource.getRepository(User).create({
      name: attributes.name,
      email: attributes.email,
      password: await services.hasher.make(attributes.password),
    }),
  );
  io.info(`Created user [${user.email}] with ID [${user.id}].`);
  return 0;
}
