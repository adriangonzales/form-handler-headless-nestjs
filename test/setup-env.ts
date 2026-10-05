// Test defaults. CI overrides DB_TYPE/DB_URL and REDIS_URL for the Postgres run.
// TZ is set for the real process in test/global-setup.ts; this keeps the
// sandbox's copy (which config validation reads) in step.
process.env.TZ = 'UTC';
process.env.APP_ENV ??= 'testing';
process.env.APP_URL ??= 'http://localhost';
process.env.APP_KEY ??= 'base64:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
process.env.JWT_SECRET ??= 'testing-jwt-secret';
process.env.DB_TYPE ??= 'sqlite';
process.env.DB_URL ??= ':memory:';
// DB 15: throttle tests FLUSHDB between cases.
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15';
process.env.QUEUE_DRIVER ??= 'sync';
process.env.MAIL_MAILER ??= 'log';
process.env.MAIL_FROM_ADDRESS ??= 'hello@example.com';
process.env.BCRYPT_ROUNDS ??= '4';
