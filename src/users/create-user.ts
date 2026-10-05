import '../config/load-env';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';
import { coreImports } from '../app.module';
import { createUser, type CreateUserIo } from './create-user.command';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy, PwnedPasswords } from './password-policy';

@Module({
  imports: coreImports,
  providers: [PasswordHasher, PasswordPolicy, PwnedPasswords],
})
class CreateUserModule {}

/** Reads a line from the terminal; `secret` input isn't echoed. */
function ask(question: string, secret: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (secret) {
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })
        ._writeToOutput;
      (
        rl as unknown as { _writeToOutput: (s: string) => void }
      )._writeToOutput = (s: string) => {
        if (s.startsWith(`${question}: `)) write.call(rl, s);
      };
    }
    rl.question(`${question}: `, (answer) => {
      rl.close();
      if (secret) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const io: CreateUserIo = {
  async ask(question, secret) {
    for (;;) {
      const answer = (await ask(question, secret)).trim();
      if (answer !== '') return answer;
      process.stderr.write('Required.\n');
    }
  },
  info: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`ERROR  ${message}\n`),
};

/**
 * `npm run user:create -- --name=… --email=… --password=…`. Missing options
 * are prompted for; leave out `--password` to keep it out of shell history.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
    },
  });
  const app = await NestFactory.createApplicationContext(CreateUserModule, {
    logger: ['error', 'warn'],
  });
  try {
    process.exitCode = await createUser(
      {
        dataSource: app.get(DataSource),
        hasher: app.get(PasswordHasher),
        policy: app.get(PasswordPolicy),
      },
      values,
      io,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(error, 'CreateUser');
  process.exitCode = 1;
});
