import { EnvValidationError } from './env';
import { validateEnv } from './index';

const valid = {
  TZ: 'UTC',
  APP_URL: 'http://localhost',
  APP_KEY: 'base64:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  JWT_SECRET: 'secret',
  DB_TYPE: 'sqlite',
  DB_URL: ':memory:',
  REDIS_URL: 'redis://127.0.0.1:6379',
  MAIL_FROM_ADDRESS: 'hello@example.com',
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    validateEnv(env);
    return [];
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
}

describe('validateEnv', () => {
  it('accepts a complete environment', () => {
    expect(problems(valid)).toEqual([]);
  });

  it('lists every missing required variable at once', () => {
    expect(problems({})).toEqual(
      expect.arrayContaining([
        'APP_URL is required',
        'APP_KEY is required',
        'JWT_SECRET is required',
        'DB_TYPE is required (one of: sqlite, postgres)',
        'DB_URL is required',
        'REDIS_URL is required',
        'MAIL_FROM_ADDRESS is required',
      ]),
    );
  });

  it('treats blank values as missing', () => {
    expect(problems({ ...valid, JWT_SECRET: '  ' })).toEqual([
      'JWT_SECRET is required',
    ]);
  });

  it('refuses to boot unless TZ is UTC', () => {
    expect(problems({ ...valid, TZ: 'Europe/London' })).toEqual([
      'TZ must be "UTC", got "Europe/London"',
    ]);
    expect(problems({ ...valid, TZ: undefined })).toEqual([
      'TZ must be "UTC", got ""',
    ]);
  });

  it('rejects invalid values', () => {
    expect(
      problems({
        ...valid,
        DB_TYPE: 'mysql',
        QUEUE_DRIVER: 'redis',
        JWT_TTL: 'soon',
        BODY_LIMIT: 'lots',
        TRUSTED_PROXIES: '10.0.0.0/8, not-an-ip',
      }),
    ).toEqual([
      'TRUSTED_PROXIES: not an IP or CIDR: not-an-ip',
      'BODY_LIMIT must be a size such as "2mb", got "lots"',
      'DB_TYPE must be one of: sqlite, postgres, got "mysql"',
      'JWT_TTL must be an integer >= 1, got "soon"',
      'QUEUE_DRIVER must be one of: bullmq, sync, got "redis"',
    ]);
  });

  it('needs POSTMARK_API_KEY only with the postmark mailer', () => {
    expect(problems({ ...valid, MAIL_MAILER: 'postmark' })).toEqual([
      'POSTMARK_API_KEY is required when MAIL_MAILER=postmark',
    ]);
  });
});
