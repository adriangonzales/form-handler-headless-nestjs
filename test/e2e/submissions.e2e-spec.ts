import Redis from 'ioredis';
import request from 'supertest';
import type { DeepPartial } from 'typeorm';
import { formStates } from '../../src/database/factories/factories';
import { FormEntry } from '../../src/form-entries/form-entry.entity';
import type { FormField } from '../../src/forms/form-field';
import { Form } from '../../src/forms/form.entity';
import { createApp, type TestApp } from '../support/create-app';
import { body, json, type ErrorBody } from '../support/json-request';
import { testRedisUrl } from '../support/redis';

/**
 * Public submissions beyond the Pest suite (ch. 3 §3.6, ch. 4, ch. 7 §7.3):
 * check order, input preparation, body types, proxies, honeypot and F9.
 * Throttlers run on the real Redis (DB 10), flushed between tests.
 */
const redisUrl = testRedisUrl(10);

/** The schema the reference fixtures were captured with. */
const SCHEMA: FormField[] = [
  { id: '01K6B6XZ00000000000000000A', order: 1, rules: ['required'] },
  { id: '01K6B6XZ00000000000000000B', order: 2, rules: ['required', 'email'] },
  { id: '01K6B6XZ00000000000000000C', order: 3, rules: ['required'] },
];
const [A, B, C] = SCHEMA.map((f) => f.id);

describe('Public submissions (port-specific)', () => {
  let t: TestApp;
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(redisUrl);
  });

  afterAll(async () => {
    await redis.quit();
  });

  const boot = async (env: Record<string, string> = {}) => {
    await redis.flushdb();
    t = await createApp({ env: { REDIS_URL: redisUrl, ...env } });
  };

  afterEach(async () => {
    await t.close();
  });

  const activeForm = (overrides: DeepPartial<Form> = {}) =>
    t.factories.form({ ...formStates.active, ...overrides });
  const entries = (form: Form) =>
    t.dataSource.getRepository(FormEntry).findBy({ formId: form.id });
  const submit = (form: Form | string, data: object = {}, query = '') =>
    json(
      t.http,
      'post',
      `/api/v1/forms/${typeof form === 'string' ? form : form.id}/submissions${query}`,
      data,
    );

  describe('check order', () => {
    beforeEach(() => boot());

    it('rate-limits unknown form IDs, so 429 comes before 404', async () => {
      for (let i = 0; i < 60; i++) {
        expect((await submit('01k6b6xz0000000000000000zz')).status).toBe(404);
      }
      const res = await submit('01k6b6xz0000000000000000zz');
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ message: 'Too Many Attempts.' });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(
        Object.keys(res.headers).filter((h) => h.startsWith('x-ratelimit')),
      ).toEqual([]);
    });

    it('gives 404 with the model message for invalid and unknown IDs', async () => {
      for (const id of ['not-a-ulid', '01k6b6xz0000000000000000zz']) {
        const res = await submit(id);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({
          message: `No query results for model [App\\Models\\Form] ${id}`,
        });
      }
    });

    it('checks the form is active before the domain, and both before validation', async () => {
      const inactive = await t.factories.form({
        ...formStates.inactive,
        schema: SCHEMA,
        settings: { domains: ['example.com'] },
      });

      const res = await submit(inactive);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'This form is not accepting submissions.',
      });
    });

    it('answers a wrong method with 405 and Allow', async () => {
      const form = await activeForm();

      const res = await json(
        t.http,
        'get',
        `/api/v1/forms/${form.id}/submissions`,
      );

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    });
  });

  describe('validation and input', () => {
    beforeEach(() => boot());

    it('reports every missing field, with Laravel attribute names', async () => {
      // Captured from the reference app ("submission validation (empty body)").
      const form = await activeForm({ schema: SCHEMA });

      const res = await submit(form);

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res)).toEqual({
        message:
          'The 01 k6 b6 x z00000000000000000 a field is required. (and 2 more errors)',
        errors: {
          [A]: ['The 01 k6 b6 x z00000000000000000 a field is required.'],
          [B]: ['The 01 k6 b6 x z00000000000000000 b field is required.'],
          [C]: ['The 01 k6 b6 x z00000000000000000 c field is required.'],
        },
      });
    });

    it('trims strings, rejects whitespace-only required values, and drops unknown keys', async () => {
      const form = await activeForm({ schema: SCHEMA });

      const blank = await submit(form, {
        [A]: '   ',
        [B]: 'a@example.com',
        [C]: 'x',
      });
      expect(blank.status).toBe(422);
      expect(Object.keys(body<ErrorBody>(blank).errors)).toEqual([A]);

      await submit(form, {
        [A]: ' Ann ',
        [B]: 'ann@example.com',
        [C]: 'Hi',
        extra: 'dropped',
      }).expect(201);

      const [entry] = await entries(form);
      expect(entry.input).toStrictEqual({
        [A]: 'Ann',
        [B]: 'ann@example.com',
        [C]: 'Hi',
      });
    });

    it('stores [] when nothing validates, and omits absent sometimes fields', async () => {
      const form = await activeForm({
        schema: [
          { id: A, order: 1 },
          { id: B, order: 2, name: 'note', rules: ['sometimes', 'string'] },
        ],
      });

      await submit(form, { other: 'x' }).expect(201);
      await submit(form, { note: 'kept' }).expect(201);

      const stored = (await entries(form)).map((e) => e.input);
      expect(stored).toContainEqual([]);
      expect(stored).toContainEqual({ note: 'kept' });
    });

    it('merges the query string into the input, body keys winning', async () => {
      const form = await activeForm({
        schema: [
          { id: A, order: 1, name: 'email', rules: ['required', 'email'] },
          { id: B, order: 2, name: 'name', rules: ['required'] },
        ],
      });

      await submit(
        form,
        { name: 'Body' },
        '?email=q@example.com&name=Query',
      ).expect(201);

      const [entry] = await entries(form);
      expect(entry.input).toStrictEqual({
        email: 'q@example.com',
        name: 'Body',
      });
    });

    it('accepts urlencoded "1" for boolean and numeric fields, and rewrites PHP keys', async () => {
      const form = await activeForm({
        schema: [
          { id: A, order: 1, name: 'agree', rules: ['boolean'] },
          { id: B, order: 2, name: 'count', rules: ['numeric'] },
          { id: C, order: 3, name: 'first_name', rules: ['required'] },
        ],
      });

      const res = await request(t.http)
        .post(`/api/v1/forms/${form.id}/submissions`)
        .type('form')
        .send('agree=1&count=1&first+name=+Ann+');

      expect(res.status).toBe(201);
      const [entry] = await entries(form);
      expect(entry.input).toStrictEqual({
        agree: '1',
        count: '1',
        first_name: 'Ann',
      });
    });

    it('answers a failed urlencoded submission with JSON 422', async () => {
      const form = await activeForm({ schema: SCHEMA });

      const res = await request(t.http)
        .post(`/api/v1/forms/${form.id}/submissions`)
        .set('Accept', 'text/html')
        .type('form')
        .send(`${A}=Ann`);

      expect(res.status).toBe(422);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(Object.keys(body<ErrorBody>(res).errors)).toEqual([B, C]);
    });

    it('accepts multipart submissions and ignores file parts', async () => {
      const form = await activeForm({
        schema: [
          { id: A, order: 1, name: 'name', rules: ['required'] },
          { id: B, order: 2, name: 'upload' },
        ],
      });

      const res = await request(t.http)
        .post(`/api/v1/forms/${form.id}/submissions`)
        .field('name', ' Ann ')
        .attach('upload', Buffer.from('file body'), 'note.txt');

      expect(res.status).toBe(201);
      const [entry] = await entries(form);
      expect(entry.input).toStrictEqual({ name: 'Ann' });
    });

    it('treats malformed JSON as an empty body', async () => {
      const form = await activeForm({ schema: SCHEMA });

      const res = await request(t.http)
        .post(`/api/v1/forms/${form.id}/submissions`)
        .set('Content-Type', 'application/json')
        .send('{"nope"');

      expect(res.status).toBe(422);
      expect(Object.keys(body<ErrorBody>(res).errors)).toEqual([A, B, C]);
    });
  });

  describe('honeypot', () => {
    beforeEach(() => boot());

    const honeypotForm = () =>
      activeForm({
        settings: { honeypot_enabled: true, honeypot_name: 'website' },
      });

    it('checks the query string too', async () => {
      const form = await honeypotForm();

      await submit(form, {}, '?website=spam').expect(201);

      const [entry] = await entries(form);
      expect(entry.spam).toBe(true);
      expect(entry.spamReason).toBe('Honeypot field was filled in.');
    });

    it.each([
      ['an empty list', { website: [] }, false],
      ['an empty object', { website: {} }, false],
      ['whitespace (trimmed to null)', { website: '   ' }, false],
      ['a list', { website: ['x'] }, true],
      ['zero', { website: 0 }, true],
      ['false', { website: false }, true],
    ])('treats %s as filled: %p', async (_name, data, tripped) => {
      const form = await honeypotForm();

      await submit(form, data).expect(201);

      const [entry] = await entries(form);
      expect(entry.spam).toBe(tripped);
    });
  });

  describe('client metadata', () => {
    it('stores every client IP in Symfony order behind trusted proxies', async () => {
      // Captured from the reference app ("submission through a proxy chain").
      await boot({ TRUSTED_PROXIES: '*' });
      const form = await activeForm({ schema: SCHEMA });

      await submit(form, { [A]: 'Ann', [B]: 'a@example.com', [C]: 'Hi' })
        .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2')
        .expect(201);

      const [entry] = await entries(form);
      expect(entry.ip).toBe('2.2.2.2,1.1.1.1');
    });

    it('ignores X-Forwarded-For from an untrusted socket', async () => {
      await boot();
      const form = await activeForm();

      await submit(form).set('X-Forwarded-For', '1.1.1.1').expect(201);

      const [entry] = await entries(form);
      expect(entry.ip).toBe('127.0.0.1');
    });

    it('cuts the user agent and referer to the column width', async () => {
      await boot();
      const form = await activeForm();

      await submit(form)
        .set('User-Agent', 'u'.repeat(300))
        .set('Referer', `https://example.com/${'é'.repeat(300)}`)
        .expect(201);

      const [entry] = await entries(form);
      expect(entry.userAgent).toBe('u'.repeat(255));
      expect([...(entry.referer ?? '')]).toHaveLength(255);
    });

    it('stores a missing user agent as null and a "0" referer as null', async () => {
      await boot();
      const form = await activeForm();

      await request(t.http)
        .post(`/api/v1/forms/${form.id}/submissions`)
        .set('User-Agent', '')
        .unset('User-Agent')
        .set('Referer', '0')
        .expect(201);

      const [entry] = await entries(form);
      expect(entry.referer).toBeNull();
    });
  });

  describe('F9: separate counters', () => {
    beforeEach(() => boot());

    it('lets password reset through after six submissions from one IP', async () => {
      const form = await activeForm();
      for (let i = 0; i < 6; i++) await submit(form).expect(201);

      const res = await json(t.http, 'post', '/api/v1/auth/forgot-password', {
        email: 'nobody@example.com',
      });

      expect(res.status).toBe(200);
    });
  });
});
