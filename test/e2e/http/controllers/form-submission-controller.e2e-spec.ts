import { EventEmitter2 } from '@nestjs/event-emitter';
import Redis from 'ioredis';
import type { DeepPartial } from 'typeorm';
import {
  formStates,
  withBasicSchema,
} from '../../../../src/database/factories/factories';
import { FormEntryCreated } from '../../../../src/events/form-entry-created.event';
import { FormEntrySubmitted } from '../../../../src/events/form-entry-submitted.event';
import { FormEntry } from '../../../../src/form-entries/form-entry.entity';
import { NotificationType } from '../../../../src/form-notifications/notification-type';
import { Form } from '../../../../src/forms/form.entity';
import { createApp, type TestApp } from '../../../support/create-app';
import { json, validationErrorKeys } from '../../../support/json-request';
import { testRedisUrl } from '../../../support/redis';

/**
 * Port of `tests/Feature/Http/Controllers/FormSubmissionControllerTest.php`
 * (10). The two submission throttlers run on the real Redis (DB 11), flushed
 * between tests. `TRUSTED_PROXIES=127.0.0.1` lets a test act as another
 * client through `X-Forwarded-For` (Pest's `REMOTE_ADDR` server variable).
 */
const redisUrl = testRedisUrl(11);

describe('FormSubmissionControllerTest', () => {
  let t: TestApp;
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(redisUrl);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
    t = await createApp({
      env: { REDIS_URL: redisUrl, TRUSTED_PROXIES: '127.0.0.1' },
    });
  });

  afterEach(async () => {
    await t.close();
  });

  const entries = (form: Form) =>
    t.dataSource.getRepository(FormEntry).findBy({ formId: form.id });
  const activeForm = (overrides: DeepPartial<Form> = {}) =>
    t.factories.form({ ...formStates.active, ...overrides });
  const submit = (
    form: Form,
    data: object = {},
    headers: Record<string, string> = {},
  ) =>
    json(t.http, 'post', `/api/v1/forms/${form.id}/submissions`, data).set(
      headers,
    );

  /** `Event::fake()`: records the entry events. */
  const recordEvents = () => {
    const seen: { event: string; id: string }[] = [];
    const emitter = t.app.get(EventEmitter2);
    for (const event of [FormEntryCreated.event, FormEntrySubmitted.event]) {
      emitter.on(event, (e: FormEntryCreated) =>
        seen.push({ event, id: e.formEntry.id }),
      );
    }
    return seen;
  };

  it('accepts a submission without authentication and responds with the redirect and message', async () => {
    const events = recordEvents();

    const form = await activeForm({
      schema: withBasicSchema(),
      settings: {
        redirect: 'https://example.com/thanks',
        message: 'Thanks, we will be in touch.',
        timezone: 'America/Chicago',
        domains: ['example.com'],
      },
    });
    const [nameField, emailField, messageField] = (form.schema ?? []).map(
      (f) => f.id,
    );

    const res = await submit(
      form,
      {
        [nameField]: 'Ada Lovelace',
        [emailField]: 'ada@example.com',
        [messageField]: 'Hello',
        unexpected: 'dropped',
      },
      { Referer: 'https://example.com/contact' },
    );

    expect(res.status).toBe(201);

    expect(res.body).toStrictEqual({
      data: {
        redirect: 'https://example.com/thanks',
        message: 'Thanks, we will be in touch.',
      },
    });

    const [entry, ...rest] = await entries(form);
    expect(rest).toEqual([]);
    expect(entry.input).toStrictEqual({
      [nameField]: 'Ada Lovelace',
      [emailField]: 'ada@example.com',
      [messageField]: 'Hello',
    });
    expect(entry.referer).toBe('https://example.com/contact');
    expect(entry.ip).toBe('127.0.0.1');

    expect(events).toEqual([
      { event: FormEntryCreated.event, id: entry.id },
      { event: FormEntrySubmitted.event, id: entry.id },
    ]);
  });

  it('responds with a null redirect and message when the form has no settings', async () => {
    const form = await activeForm({ settings: null });

    const res = await submit(form);

    expect(res.status).toBe(201);

    expect(res.body).toStrictEqual({
      data: { redirect: null, message: null },
    });
  });

  it('stores a submission that fills in the honeypot as spam without alerting', async () => {
    const form = await activeForm({
      schema: withBasicSchema(),
      settings: {
        honeypot_enabled: true,
        honeypot_name: 'website',
        message: 'Thanks!',
      },
    });
    await t.factories.notification({
      formId: form.id,
      type: NotificationType.Email,
      enabled: true,
    });
    const [nameField, emailField, messageField] = (form.schema ?? []).map(
      (f) => f.id,
    );

    const res = await submit(form, {
      [nameField]: 'Bot',
      [emailField]: 'bot@example.com',
      [messageField]: 'Buy now',
      website: 'https://spam.example',
    });

    expect(res.status).toBe(201);
    expect(res.body).toStrictEqual({
      data: { redirect: null, message: 'Thanks!' },
    });

    const [entry] = await entries(form);
    expect(entry.spam).toBe(true);
    expect(entry.spamReason).toBe('Honeypot field was filled in.');
    expect(entry.spamCheckedAt).toEqual(t.clock.now());
    expect(entry.input).not.toHaveProperty('website');
    // `Queue::assertNotPushed(DeliverFormEntryAlert::class)`: alerts arrive
    // in phase 6; nothing was sent.
    expect(t.mail.sent).toEqual([]);
  });

  it.each([
    [
      'honeypot left empty',
      { honeypot_enabled: true, honeypot_name: 'website' },
      { website: '' },
    ],
    [
      'honeypot omitted',
      { honeypot_enabled: true, honeypot_name: 'website' },
      {},
    ],
    [
      'honeypot disabled',
      { honeypot_enabled: false, honeypot_name: 'website' },
      { website: 'https://spam.example' },
    ],
  ])(
    'accepts a submission as not spam when the honeypot is empty or disabled (%s)',
    async (_name, settings, extraInput) => {
      const form = await activeForm({ settings });

      expect((await submit(form, extraInput)).status).toBe(201);

      const [entry] = await entries(form);
      expect(entry.spam).toBe(false);
      expect(entry.spamReason).toBeNull();
      expect(entry.spamCheckedAt).toBeNull();
    },
  );

  it('validates a submission against the form schema', async () => {
    const form = await activeForm({ schema: withBasicSchema() });
    const fieldIds = (form.schema ?? []).map((f) => f.id);

    const res = await submit(form, { [fieldIds[1]]: 'not an email' });

    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toEqual(
      expect.arrayContaining(fieldIds),
    );

    expect(await entries(form)).toHaveLength(0);
  });

  it('rejects submissions to an inactive form', async () => {
    const events = recordEvents();

    const form = await t.factories.form({
      ...formStates.inactive,
      schema: withBasicSchema(),
    });

    const res = await submit(form);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      message: 'This form is not accepting submissions.',
    });

    expect(await entries(form)).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('returns not found for a deleted form', async () => {
    const form = await activeForm();
    await t.dataSource
      .getRepository(Form)
      .update({ id: form.id }, { deletedAt: t.clock.now() });

    expect((await submit(form)).status).toBe(404);
  });

  it.each([
    ['exact domain', 'https://example.com/contact', true],
    ['exact domain in another case', 'https://EXAMPLE.com/contact', true],
    ['wildcard subdomain', 'https://forms.example.org/', true],
    ['nested wildcard subdomain', 'https://a.b.example.org/', true],
    ['bare domain of a wildcard', 'https://example.org/', false],
    ['subdomain of an exact domain', 'https://www.example.com/', false],
    ['lookalike domain', 'https://evil-example.com/', false],
    ['suffix of an allowed domain', 'https://example.com.evil.net/', false],
    ['not a url', 'example.com', false],
    ['missing referer', null, false],
  ])(
    'only accepts submissions referred from an allowed domain (%s)',
    async (_name, referer, allowed) => {
      const events = recordEvents();

      const form = await activeForm({
        schema: withBasicSchema(),
        settings: { domains: ['example.com', '*.example.org'] },
      });

      const res = await submit(
        form,
        {},
        referer === null ? {} : { Referer: referer },
      );

      if (allowed) {
        expect(res.status).toBe(422);
        return;
      }

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        message: 'Submissions are not accepted from this domain.',
      });
      expect(events).toEqual([]);
    },
  );

  it('limits submissions to each form per client', async () => {
    const form = await activeForm();
    const otherForm = await activeForm();

    for (let attempt = 1; attempt <= 60; attempt++) {
      expect((await submit(form)).status).toBe(201);
    }

    expect((await submit(form)).status).toBe(429);
    expect((await submit(otherForm)).status).toBe(201);
    expect(
      (await submit(form, {}, { 'X-Forwarded-For': '203.0.113.7' })).status,
    ).toBe(201);
  });

  it('limits submissions per client across forms', async () => {
    const forms: Form[] = [];
    for (let i = 0; i < 6; i++) forms.push(await activeForm());

    for (let attempt = 1; attempt <= 300; attempt++) {
      expect((await submit(forms[attempt % 6])).status).toBe(201);
    }

    expect((await submit(forms[0])).status).toBe(429);
  });
});
