// Test defaults. CI overrides DB_TYPE/DB_URL and REDIS_URL for the Postgres run.
process.env.TZ = 'UTC';
process.env.APP_ENV ??= 'testing';
process.env.APP_URL ??= 'http://localhost';
process.env.APP_KEY ??= 'base64:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
process.env.JWT_SECRET ??= 'testing-jwt-secret';
process.env.DB_TYPE ??= 'sqlite';
process.env.DB_URL ??= ':memory:';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.QUEUE_DRIVER ??= 'sync';
process.env.MAIL_MAILER ??= 'log';
process.env.MAIL_FROM_ADDRESS ??= 'hello@example.com';
