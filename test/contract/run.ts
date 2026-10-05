/**
 * Runs the contract suite against a freshly booted server:
 *
 *   npm run contract:laravel   # the reference app (needs PHP and LARAVEL_PATH)
 *   npm run contract:nest      # this app, built (npm run build), on SQLite
 *
 * Or point it at any running server yourself:
 *   CONTRACT_BASE_URL=… CONTRACT_TARGET=laravel|nest CONTRACT_EMAIL=… CONTRACT_PASSWORD=… npm run test:contract
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  startLaravel,
  waitFor,
  type RunningServer,
  type ServerUser,
} from '../fixtures/laravel/laravel-server';

const ROOT = resolve(__dirname, '..', '..');
const USER: ServerUser = {
  name: 'Contract User',
  email: 'contract@example.com',
  password: 'contract-password-1',
};
/** Changes its password and deletes itself in the account cases. */
const ACCOUNT_USER: ServerUser = {
  name: 'Account User',
  email: 'contract-account@example.com',
  password: 'account-password-1',
};
const USERS = [USER, ACCOUNT_USER];

async function startNest(port: number): Promise<RunningServer> {
  const tmp = mkdtempSync(join(tmpdir(), 'nest-contract-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TZ: 'UTC',
    NODE_ENV: 'production',
    APP_ENV: 'local',
    APP_URL: `http://127.0.0.1:${port}`,
    APP_KEY: 'base64:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    JWT_SECRET: 'contract-jwt-secret-contract-jwt-secret-0123456789',
    DB_TYPE: 'sqlite',
    DB_URL: join(tmp, 'database.sqlite'),
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/14',
    QUEUE_DRIVER: 'sync',
    MAIL_MAILER: 'log',
    MAIL_FROM_ADDRESS: 'hello@example.com',
    TRUSTED_PROXIES: '127.0.0.1',
    PORT: String(port),
  };
  execFileSync(
    'node',
    [
      'node_modules/.bin/typeorm',
      'migration:run',
      '-d',
      'dist/database/data-source.js',
    ],
    { cwd: ROOT, env, stdio: 'pipe' },
  );
  for (const user of USERS) {
    execFileSync(
      'node',
      [
        'dist/users/create-user.js',
        `--name=${user.name}`,
        `--email=${user.email}`,
        `--password=${user.password}`,
      ],
      { cwd: ROOT, env, stdio: 'pipe' },
    );
  }
  const server = spawn('node', ['dist/main.js'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  const stop = () => {
    server.kill('SIGTERM');
    rmSync(tmp, { recursive: true, force: true });
  };
  try {
    await waitFor(`http://127.0.0.1:${port}/up`);
  } catch (error) {
    stop();
    throw error;
  }
  return { baseUrl: `http://127.0.0.1:${port}`, stop };
}

/**
 * Refuses a port something already answers on (Herd's PHP holds 127.0.0.1:8001
 * on this machine), so the suite never tests the wrong server.
 */
async function assertPortFree(port: number): Promise<void> {
  const answered = await fetch(`http://127.0.0.1:${port}/`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(1000),
  }).then(
    () => true,
    () => false,
  );
  if (answered)
    throw new Error(
      `Port ${port} is already in use; set CONTRACT_PORT to a free port`,
    );
}

async function main(): Promise<void> {
  const target = process.argv[2] === 'laravel' ? 'laravel' : 'nest';
  const port = Number(
    process.env.CONTRACT_PORT ?? (target === 'laravel' ? 8010 : 8011),
  );
  await assertPortFree(port);
  const server =
    target === 'laravel'
      ? await startLaravel({ port, users: USERS })
      : await startNest(port);
  try {
    const result = spawnSync(
      'npx',
      ['jest', '--config', 'test/jest-contract.json', ...process.argv.slice(3)],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          CONTRACT_BASE_URL: server.baseUrl,
          CONTRACT_TARGET: target,
          CONTRACT_EMAIL: USER.email,
          CONTRACT_PASSWORD: USER.password,
          CONTRACT_ACCOUNT_EMAIL: ACCOUNT_USER.email,
          CONTRACT_ACCOUNT_PASSWORD: ACCOUNT_USER.password,
        },
      },
    );
    process.exitCode = result.status ?? 1;
  } finally {
    server.stop();
  }
}

void main();
