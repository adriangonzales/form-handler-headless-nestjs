/**
 * Boots the reference Laravel app for fixture capture and the contract suite:
 * a fresh SQLite database in a temp directory, a fixed clock (one second per
 * request), `QUEUE_CONNECTION=sync`, the array mailer, logs on stderr, and
 * production's PHP limits. Nothing is written to the Laravel repo.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ServerUser {
  name: string;
  email: string;
  password: string;
}

export interface RunningServer {
  baseUrl: string;
  stop(): void;
}

export const LARAVEL_PATH = resolve(
  process.env.LARAVEL_PATH ??
    join(__dirname, '..', '..', '..', '..', 'form-handler-headless-laravel'),
);

export async function startLaravel(options: {
  port: number;
  users: ServerUser[];
  /**
   * Captures pass a base time: every request then sees it plus one second
   * per request served, for deterministic timestamps. Without one the app
   * runs on the real clock, which rate-limit windows need.
   */
  clockBase?: number;
}): Promise<RunningServer> {
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const tmp = mkdtempSync(join(tmpdir(), 'laravel-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: 'local',
    APP_DEBUG: 'false',
    APP_URL: baseUrl,
    APP_KEY: 'base64:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    JWT_SECRET: 'contract-jwt-secret-contract-jwt-secret-0123456789',
    DB_CONNECTION: 'sqlite',
    DB_DATABASE: join(tmp, 'database.sqlite'),
    QUEUE_CONNECTION: 'sync',
    CACHE_STORE: 'database',
    MAIL_MAILER: 'array',
    LOG_CHANNEL: 'stderr',
    TYPESAFE_API_KEY: '',
    TRUSTED_PROXIES: '127.0.0.1',
    ...(options.clockBase !== undefined && {
      CAPTURE_CLOCK_FILE: join(tmp, 'clock'),
      CAPTURE_CLOCK_BASE: String(options.clockBase),
    }),
  };
  writeFileSync(env.DB_DATABASE as string, '');
  const artisan = (...args: string[]) =>
    execFileSync('php', ['artisan', ...args], {
      cwd: LARAVEL_PATH,
      env,
      stdio: 'pipe',
    });
  artisan('migrate:fresh', '--force');
  for (const user of options.users) {
    artisan(
      'user:create',
      `--name=${user.name}`,
      `--email=${user.email}`,
      `--password=${user.password}`,
    );
  }

  const server = spawn(
    'php',
    [
      // Production's PHP limits (ch. 1 §1.4); errors must not leak into responses.
      '-d',
      'post_max_size=2M',
      '-d',
      'max_input_vars=1000',
      '-d',
      'display_errors=0',
      '-S',
      `127.0.0.1:${options.port}`,
      join(__dirname, 'scripts', 'router.php'),
    ],
    { cwd: join(LARAVEL_PATH, 'public'), env, stdio: 'ignore' },
  );
  const stop = () => {
    server.kill('SIGTERM');
    rmSync(tmp, { recursive: true, force: true });
  };
  try {
    await waitFor(`${baseUrl}/up`);
  } catch (error) {
    stop();
    throw error;
  }
  return { baseUrl, stop };
}

export async function waitFor(url: string, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`${url} did not come up`);
}
