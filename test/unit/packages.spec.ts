/**
 * ch. 1 §1.1: Nest compiles to CommonJS and Jest runs through ts-jest, so
 * every runtime package must load under Jest's module system. Node 22 can
 * `require()` ESM, but Jest can't, so this catches ESM-only majors (the
 * `@nestjs/*` v12 line and `@faker-js/faker` v10 are ESM-only).
 *
 * Static imports on purpose: they compile to `require()`, as app code does.
 */
import { faker } from '@faker-js/faker';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { SwaggerModule } from '@nestjs/swagger';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { compareSync, hashSync } from 'bcrypt';
import { Queue } from 'bullmq';
import { stringify } from 'csv-stringify/sync';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';
import { Client } from 'pg';
import { ServerClient } from 'postmark';
import { DataSource } from 'typeorm';
import { UAParser } from 'ua-parser-js';
import { ulid } from 'ulid';
import validator from 'validator';

describe('packages load under Jest', () => {
  it('typeorm + better-sqlite3 open an in-memory database', async () => {
    const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await expect(ds.query('select 1 as one')).resolves.toEqual([{ one: 1 }]);
    await ds.destroy();
  });

  it('Nest modules', () => {
    for (const mod of [
      BullModule,
      ConfigModule,
      EventEmitterModule,
      SwaggerModule,
      ThrottlerModule,
      TypeOrmModule,
    ]) {
      expect(typeof mod).toBe('function');
    }
  });

  it('pg', () => {
    expect(typeof Client).toBe('function');
  });

  it('ulid', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('validator', () => {
    expect(validator.isEmail('a@example.com')).toBe(true);
  });

  it('ioredis and the nest-lab throttler storage', () => {
    const redis = new Redis({ lazyConnect: true });
    expect(new ThrottlerStorageRedisService(redis)).toBeDefined();
    redis.disconnect();
  });

  it('@nestjs/jwt', () => {
    const jwt = new JwtService({ secret: 's' });
    expect(jwt.verify<{ sub: string }>(jwt.sign({ sub: '1' })).sub).toBe('1');
  });

  it('bcrypt verifies a PHP $2y$ hash only after rewriting it to $2b$', () => {
    // php -r 'echo password_hash("password", PASSWORD_BCRYPT, ["cost" => 4]);'
    const php = '$2y$04$1zfyG2LELlyzx9xdYrPQeOvCUAJ1B1E8U24vGmijprDpWwqn8/Ety';
    expect(compareSync('password', php)).toBe(false);
    expect(compareSync('password', php.replace(/^\$2y\$/, '$2b$'))).toBe(true);
    expect(hashSync('password', 4)).toMatch(/^\$2b\$04\$/);
  });

  it('bullmq', () => {
    expect(typeof Queue).toBe('function');
  });

  it('nodemailer and postmark', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const info = await transport.sendMail({ from: 'a@b.c', to: 'd@e.f' });
    expect(info.messageId).toBeDefined();
    expect(typeof ServerClient).toBe('function');
  });

  it('ua-parser-js v1', () => {
    const result = new UAParser(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ).getResult();
    expect(result.browser.name).toBe('Chrome');
    expect(result.os.name).toBe('Windows');
  });

  it('csv-stringify/sync', () => {
    expect(stringify([['a', 'b c']])).toBe('a,b c\n');
  });

  it('@faker-js/faker', () => {
    expect(faker.internet.email()).toContain('@');
  });
});
