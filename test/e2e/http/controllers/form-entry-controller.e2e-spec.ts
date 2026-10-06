import { faker } from '@faker-js/faker';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ulid } from 'ulid';
import type { DeepPartial } from 'typeorm';
import {
  formStates,
  withBasicSchema,
} from '../../../../src/database/factories/factories';
import { FormEntryCreated } from '../../../../src/events/form-entry-created.event';
import { FormEntrySubmitted } from '../../../../src/events/form-entry-submitted.event';
import { FormEntry } from '../../../../src/form-entries/form-entry.entity';
import { formEntryResource } from '../../../../src/form-entries/form-entry.resource';
import { SUBMISSION_FIELDS } from '../../../../src/form-entries/rules/form-entry.rules';
import { Form } from '../../../../src/forms/form.entity';
import type { User } from '../../../../src/users/user.entity';
import { createApp, type TestApp } from '../../../support/create-app';
import { body, json, validationErrorKeys } from '../../../support/json-request';

type EntryBody = ReturnType<typeof formEntryResource>;

interface ListBody {
  data: EntryBody[];
  links: Record<'first' | 'last' | 'prev' | 'next', string | null>;
  meta: { current_page: number; per_page: number; last_page: number };
}

const ENTRY_KEYS = [
  'id',
  'form_id',
  'input',
  'ip',
  'ip_location_display',
  'referer',
  'user_agent',
  'user_agent_display',
  'spam',
  'spam_score',
  'spam_reason',
  'spam_checked_at',
  'starred',
  'read_at',
  'created_at',
  'updated_at',
  'deleted_at',
];

/** Port of `tests/Feature/Http/Controllers/FormEntryControllerTest.php` (46). */
describe('FormEntryControllerTest', () => {
  let t: TestApp;
  let user: User;
  let form: Form;

  beforeEach(async () => {
    t = await createApp();
    actor = undefined;
    user = await t.factories.user();
    form = await t.factories.form({ userId: user.id });
  });

  afterEach(async () => {
    await t.close();
  });

  const entries = () => t.dataSource.getRepository(FormEntry);
  const forms = () => t.dataSource.getRepository(Form);
  const entry = (overrides: DeepPartial<FormEntry> = {}) =>
    t.factories.entry({ formId: form.id, ...overrides });
  /** `$entry->fresh()`, or null when it's gone. */
  const fresh = (target: FormEntry) =>
    entries().findOne({ where: { id: target.id }, withDeleted: true });
  const freshJson = async (target: FormEntry) =>
    formEntryResource((await fresh(target)) as FormEntry);
  /** `$model->delete()` on a soft-deleting model. */
  const softDelete = (target: FormEntry | Form) =>
    t.dataSource
      .getRepository(target.constructor)
      .update({ id: target.id }, { deletedAt: t.clock.now() });
  const activate = () => forms().update({ id: form.id }, { active: true });
  /** `$this->travelTo($date)`. */
  const travelTo = (date: string) =>
    t.clock.set(
      `${date.length === 10 ? `${date} 00:00:00` : date}Z`.replace(' ', 'T'),
    );

  /** `$this->actingAs($user)`: a token minted at the current (fake) time per request. */
  let actor: User | undefined;
  const actingAs = (as: User) => {
    actor = as;
  };
  const send = async (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    data?: object,
    headers: Record<string, string> = {},
  ) => {
    const token = actor === undefined ? undefined : await t.apiToken(actor);
    return json(t.http, method, url, data, token).set(headers);
  };
  const get = (url: string) => send('get', url);

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

  const expectValidationError = (
    res: { status: number; body: unknown },
    key: string,
  ) => {
    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toContain(key);
  };

  const ids = (res: { body: unknown }) =>
    body<ListBody>(res).data.map((e) => e.id);

  it('requires authentication to view the form entry index', async () => {
    const res = await get(`/api/v1/forms/${form.id}/entries`);
    expect(res.status).toBe(401);
  });

  it('lists results from the index', async () => {
    actingAs(user);

    await entry();

    const res = await get(`/api/v1/forms/${form.id}/entries`);

    expect(res.status).toBe(200);
    const list = body<ListBody>(res);
    for (const item of list.data) {
      for (const key of ENTRY_KEYS) expect(item).toHaveProperty(key);
    }
    for (const key of ['first', 'last', 'prev', 'next']) {
      expect(list.links).toHaveProperty(key);
    }
    expect(list.meta).toHaveProperty('current_page');
    expect(list.data).toHaveLength(1);
  });

  it('only lists entries belonging to the requested form', async () => {
    actingAs(user);

    const mine = await entry();
    await t.factories.entry();

    const res = await get(`/api/v1/forms/${form.id}/entries`);

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([mine.id]);
  });

  it('shows single form entry', async () => {
    actingAs(user);

    const target = await entry();

    const res = await get(`/api/v1/entries/${target.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { id: target.id } });
    for (const key of ENTRY_KEYS.filter((k) => k !== 'spam_checked_at')) {
      expect(body<{ data: EntryBody }>(res).data).toHaveProperty(key);
    }
    expect(res.body).not.toHaveProperty('id');
  });

  it('creates a new form entry', async () => {
    actingAs(user);
    await activate();

    const name = faker.person.fullName();

    const events = recordEvents();
    travelTo('2026-01-02 03:04:05');

    const res = await send(
      'post',
      `/api/v1/forms/${form.id}/entries`,
      { name },
      // Laravel's test client sends `User-Agent: Symfony`.
      { 'User-Agent': 'Symfony' },
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      data: {
        form_id: form.id,
        input: [],
        ip: '127.0.0.1',
        ip_location_display: null,
        referer: null,
        user_agent: 'Symfony',
        user_agent_display: null,
        spam: false,
        spam_score: 0.0,
        spam_reason: null,
        spam_checked_at: '2026-01-02T03:04:05.000000Z',
        starred: false,
        read_at: null,
      },
    });

    const stored = await entries().findBy({ formId: form.id });

    expect(stored).toHaveLength(1);
    expect(events).toContainEqual({
      event: FormEntryCreated.event,
      id: stored[0].id,
    });
    expect(events.map((e) => e.event)).not.toContain(FormEntrySubmitted.event);
  });

  it('does not check for spam, alert or parse the user agent for entries created through the API', async () => {
    // The spam check, alerts and UA parsing listen for form-entry.submitted
    // (phase 6); the API create never emits it.
    const events = recordEvents();
    await t.factories.notification({
      formId: form.id,
      type: 'email' as never,
      enabled: true,
    });
    await activate();
    actingAs(user);

    const res = await send(
      'post',
      `/api/v1/forms/${form.id}/entries`,
      {},
      {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      },
    );

    expect(res.status).toBe(201);
    const [stored] = await entries().findBy({ formId: form.id });
    expect(stored.spam).toBe(false);
    expect(stored.userAgentDisplay).toBeNull();
    expect(events.map((e) => e.event)).not.toContain(FormEntrySubmitted.event);
  });

  it.each([
    [
      'present',
      'https://example.com/contact?utm_source=newsletter',
      'https://example.com/contact?utm_source=newsletter',
    ],
    [
      'longer than the column',
      `https://example.com/${'a'.repeat(300)}`,
      `https://example.com/${'a'.repeat(235)}`,
    ],
    ['absent', null, null],
  ])(
    'records the referer of a submission (%s)',
    async (_name, referer, expected) => {
      actingAs(user);
      await activate();

      const res = await send(
        'post',
        `/api/v1/forms/${form.id}/entries`,
        {},
        referer === null ? {} : { Referer: referer },
      );

      expect(res.status).toBe(201);
      expect(body<{ data: EntryBody }>(res).data.referer).toBe(expected);

      const [stored] = await entries().findBy({ formId: form.id });
      expect(stored.referer).toBe(expected);
    },
  );

  it('stores only validated schema fields as input', async () => {
    actingAs(user);
    const basic = await t.factories.form({
      ...formStates.active,
      schema: withBasicSchema(),
      userId: user.id,
    });
    const [nameField, emailField, messageField] = (basic.schema ?? []).map(
      (f) => f.id,
    );

    const res = await send('post', `/api/v1/forms/${basic.id}/entries`, {
      [nameField]: 'Ada Lovelace',
      [emailField]: 'ada@example.com',
      [messageField]: 'Hello',
      unexpected: 'dropped',
    });

    const expectedInput = {
      [nameField]: 'Ada Lovelace',
      [emailField]: 'ada@example.com',
      [messageField]: 'Hello',
    };

    expect(res.status).toBe(201);
    expect(body<{ data: EntryBody }>(res).data.input).toStrictEqual(
      expectedInput,
    );

    const [stored] = await entries().findBy({ formId: basic.id });
    expect(stored.input).toStrictEqual(expectedInput);
  });

  it('rejects entries for an inactive form', async () => {
    actingAs(user);
    const inactive = await t.factories.form({
      ...formStates.inactive,
      schema: withBasicSchema(),
      userId: user.id,
    });

    const events = recordEvents();

    const res = await send('post', `/api/v1/forms/${inactive.id}/entries`, {});

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      message: 'This form is not accepting submissions.',
    });
    expect(await entries().countBy({ formId: inactive.id })).toBe(0);
    expect(events).toEqual([]);
  });

  it('includes timestamps in the form entry resource', async () => {
    actingAs(user);

    travelTo('2026-01-02 03:04:05');
    const target = await entry({ readAt: new Date('2026-01-03T04:05:06Z') });

    const res = await get(`/api/v1/entries/${target.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        read_at: '2026-01-03T04:05:06.000000Z',
        created_at: '2026-01-02T03:04:05.000000Z',
        updated_at: '2026-01-02T03:04:05.000000Z',
        deleted_at: null,
      },
    });
  });

  it.each([
    ['default is oldest first', null, [0, 2, 1]],
    ['ascending', 'created_at', [0, 2, 1]],
    ['descending', '-created_at', [1, 2, 0]],
  ])(
    'sorts the entry index by created_at (%s)',
    async (_name, sort, expectedOrder) => {
      actingAs(user);

      const created: FormEntry[] = [];
      for (const date of ['2026-01-01', '2026-03-01', '2026-02-01']) {
        travelTo(date);
        created.push(await entry());
      }

      const res = await get(
        `/api/v1/forms/${form.id}/entries${sort === null ? '' : `?sort=${sort}`}`,
      );

      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(expectedOrder.map((i) => created[i].id));
    },
  );

  it.each([
    ['ascending', 'spam_score', [0.1, 0.5, 0.9]],
    ['descending', '-spam_score', [0.9, 0.5, 0.1]],
  ])(
    'sorts the entry index by spam_score (%s)',
    async (_name, sort, expectedScores) => {
      actingAs(user);

      for (const spamScore of [0.5, 0.9, 0.1]) await entry({ spamScore });

      const res = await get(`/api/v1/forms/${form.id}/entries?sort=${sort}`);

      expect(res.status).toBe(200);
      expect(body<ListBody>(res).data.map((e) => e.spam_score)).toEqual(
        expectedScores,
      );
    },
  );

  it.each([
    ['read', 'true', true],
    ['unread', '0', false],
  ])(
    'filters the entry index by read state (%s)',
    async (_name, value, expectRead) => {
      actingAs(user);

      const read = await entry({ readAt: t.clock.now() });
      const unread = await entry({ readAt: null });

      const res = await get(
        `/api/v1/forms/${form.id}/entries?filter[read]=${value}`,
      );

      expect(res.status).toBe(200);
      expect(ids(res)).toEqual([(expectRead ? read : unread).id]);
    },
  );

  it.each([
    ['starred', '1', true],
    ['not starred', 'false', false],
  ])(
    'filters the entry index by starred (%s)',
    async (_name, value, expectStarred) => {
      actingAs(user);

      const starred = await entry({ starred: true });
      const unstarred = await entry({ starred: false });

      const res = await get(
        `/api/v1/forms/${form.id}/entries?filter[starred]=${value}`,
      );

      expect(res.status).toBe(200);
      expect(ids(res)).toEqual([(expectStarred ? starred : unstarred).id]);
    },
  );

  it.each([
    ['spam', 'true', ['spam']],
    ['not spam', 'false', ['ham', 'unchecked']],
  ])(
    'filters the entry index by spam, treating unchecked entries as not spam (%s)',
    async (_name, value, expectedKeys) => {
      actingAs(user);

      const created: Record<string, FormEntry> = {
        spam: await entry({ spam: true }),
        ham: await entry({ spam: false }),
        unchecked: await entry({ spam: null }),
      };

      const res = await get(
        `/api/v1/forms/${form.id}/entries?filter[spam]=${value}`,
      );

      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(expectedKeys.map((key) => created[key].id));
    },
  );

  it('filters the entry index by an inclusive created date range', async () => {
    actingAs(user);

    const created: FormEntry[] = [];
    for (const date of [
      '2026-01-31 23:59:59',
      '2026-02-01 00:00:00',
      '2026-02-28 23:59:59',
      '2026-03-01 00:00:00',
    ]) {
      travelTo(date);
      created.push(await entry());
    }

    const res = await get(
      `/api/v1/forms/${form.id}/entries?filter[created_from]=2026-02-01&filter[created_to]=2026-02-28`,
    );

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([created[1].id, created[2].id]);
  });

  it('combines entry filters with sorting', async () => {
    actingAs(user);

    travelTo('2026-01-01');
    const older = await entry({ readAt: null, starred: true });
    travelTo('2026-01-02');
    const newer = await entry({ readAt: null, starred: true });
    await entry({ readAt: t.clock.now(), starred: true });
    await entry({ readAt: null, starred: false });

    const res = await get(
      `/api/v1/forms/${form.id}/entries?sort=-created_at&filter[read]=false&filter[starred]=true`,
    );

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([newer.id, older.id]);
  });

  it('keeps the sort and filters in entry pagination links', async () => {
    actingAs(user);

    for (let i = 0; i < 16; i++) await entry({ starred: true });

    const res = await get(
      `/api/v1/forms/${form.id}/entries?sort=-created_at&filter[starred]=true`,
    );

    expect(res.status).toBe(200);
    const next = decodeURIComponent(body<ListBody>(res).links.next ?? '');
    expect(next).toContain('sort=-created_at');
    expect(next).toContain('filter[starred]=true');
  });

  it('pages the entry index by the requested page size', async () => {
    actingAs(user);
    for (let i = 0; i < 3; i++) await entry();

    const res = await get(`/api/v1/forms/${form.id}/entries?per_page=2`);

    expect(res.status).toBe(200);
    const list = body<ListBody>(res);
    expect(list.data).toHaveLength(2);
    expect(list.meta.per_page).toBe(2);
    expect(list.meta.last_page).toBe(2);
    expect(list.links.next).toContain('per_page=2');
  });

  it.each([
    ['unsupported sort', 'sort=ip', 'sort'],
    ['combined sort', 'sort=created_at,-spam_score', 'sort'],
    ['unknown filter', 'filter[ip]=127.0.0.1', 'filter'],
    ['invalid boolean', 'filter[starred]=yes', 'filter.starred'],
    [
      'invalid date',
      'filter[created_from]=2026-02-01T00:00:00',
      'filter.created_from',
    ],
    [
      'reversed range',
      'filter[created_from]=2026-02-02&filter[created_to]=2026-02-01',
      'filter.created_to',
    ],
    ['invalid trashed value', 'filter[trashed]=all', 'filter.trashed'],
    ['page size too small', 'per_page=0', 'per_page'],
    ['page size too large', 'per_page=101', 'per_page'],
    ['non-integer page size', 'per_page=all', 'per_page'],
  ])(
    'rejects an invalid entry sort or filter (%s)',
    async (_name, query, errorKey) => {
      actingAs(user);

      const res = await get(`/api/v1/forms/${form.id}/entries?${query}`);

      expectValidationError(res, errorKey);
    },
  );

  it('forbids creating an entry on a form the user does not own', async () => {
    actingAs(await t.factories.user());
    const theirs = await t.factories.form({
      ...formStates.active,
      schema: withBasicSchema(),
      userId: user.id,
    });

    const events = recordEvents();

    const res = await send('post', `/api/v1/forms/${theirs.id}/entries`, {});

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'You do not own this form.' });
    expect(await entries().countBy({ formId: theirs.id })).toBe(0);
    expect(events).toEqual([]);
  });

  it('forbids listing entries for a form the user does not own', async () => {
    actingAs(await t.factories.user());

    await entry();

    const res = await get(`/api/v1/forms/${form.id}/entries?sort=invalid`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'You do not own this form.' });
  });

  it('forbids showing an entry on a form the user does not own', async () => {
    actingAs(await t.factories.user());

    const target = await entry();

    const res = await get(`/api/v1/entries/${target.id}`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'You do not own this form.' });
  });

  it('updates an entry on a form the user owns', async () => {
    actingAs(user);

    const target = await entry({ starred: false });

    const res = await send('put', `/api/v1/entries/${target.id}`, {
      spam_score: 0,
      starred: true,
    });

    expect(res.status).toBe(200);
    expect(body<{ data: EntryBody }>(res).data.starred).toBe(true);
  });

  it.each([
    ['star', { starred: false }, { starred: true }, 'starred', true],
    ['unstar', { starred: true }, { starred: false }, 'starred', false],
    [
      'mark read',
      { readAt: null },
      { read_at: '2026-01-02T03:04:05Z' },
      'read_at',
      '2026-01-02T03:04:05.000000Z',
    ],
    [
      'mark unread',
      { readAt: new Date('2026-01-02T03:04:05Z') },
      { read_at: null },
      'read_at',
      null,
    ],
  ] as const)(
    'triages a single entry (%s)',
    async (_name, before, payload, attribute, expected) => {
      actingAs(user);

      const target = await entry(before);

      const res = await send('patch', `/api/v1/entries/${target.id}`, payload);

      expect(res.status).toBe(200);
      expect(body<{ data: EntryBody }>(res).data[attribute]).toBe(expected);

      expect((await freshJson(target))[attribute]).toBe(expected);
    },
  );

  it('updates only the fields sent in a partial update', async () => {
    actingAs(user);
    travelTo('2026-01-02 03:04:05');

    const target = await entry({
      starred: true,
      spamScore: 0.5,
      readAt: null,
    });

    const res = await send('patch', `/api/v1/entries/${target.id}`, {
      read_at: '2026-01-02T03:04:05.000000Z',
    });

    expect(res.status).toBe(200);
    const stored = (await fresh(target)) as FormEntry;
    expect(stored.readAt).toEqual(t.clock.now());
    expect(stored.starred).toBe(true);
    expect(stored.spamScore).toBe(0.5);
  });

  it('rejects a read_at that is not a date', async () => {
    actingAs(user);

    const target = await entry();

    const res = await send('patch', `/api/v1/entries/${target.id}`, {
      read_at: 'yesterday-ish',
    });

    expectValidationError(res, 'read_at');
  });

  it('rounds the spam score to two decimal places', async () => {
    actingAs(user);

    const target = await entry();

    const res = await send('patch', `/api/v1/entries/${target.id}`, {
      spam_score: 0.456,
    });

    expect(res.status).toBe(200);
    expect(body<{ data: EntryBody }>(res).data.spam_score).toBe(0.46);

    expect(((await fresh(target)) as FormEntry).spamScore).toBe(0.46);
  });

  it.each([
    ['negative', -0.1],
    ['too large', 10],
  ])(
    'rejects a spam score outside the column range (%s)',
    async (_name, score) => {
      actingAs(user);

      const target = await entry();

      const res = await send('patch', `/api/v1/entries/${target.id}`, {
        spam_score: score,
      });

      expectValidationError(res, 'spam_score');
    },
  );

  it.each(['spam_score', 'starred'])(
    'rejects an empty value for a sent triage field (%s)',
    async (field) => {
      actingAs(user);

      const target = await entry();

      const res = await send('patch', `/api/v1/entries/${target.id}`, {
        [field]: null,
      });

      expectValidationError(res, field);
    },
  );

  it.each([
    ['starred word', 'starred', 'banana'],
    ['starred yes', 'starred', 'yes'],
    ['spam word', 'spam', 'banana'],
    ['spam yes', 'spam', 'yes'],
  ])(
    'rejects non-boolean triage flags on update (%s)',
    async (_name, field, value) => {
      actingAs(user);

      const target = await entry({ starred: false, spam: false });

      const res = await send('patch', `/api/v1/entries/${target.id}`, {
        [field]: value,
      });

      expectValidationError(res, field);
      const stored = (await fresh(target)) as FormEntry;
      expect(stored.starred).toBe(false);
      expect(stored.spam).toBe(false);
    },
  );

  it.each([
    ['input', 'input', { name: 'Edited' }],
    ['ip', 'ip', '10.0.0.1'],
    ['ip_location_display', 'ip_location_display', 'Elsewhere'],
    ['referer', 'referer', 'https://edited.example'],
    ['user_agent', 'user_agent', 'Edited'],
    [
      'user_agent_display',
      'user_agent_display',
      { platform: 'Edited', browser: null, browser_version: null },
    ],
    ['spam_checked_at', 'spam_checked_at', null],
    ['null input', 'input', null],
    ['null ip', 'ip', null],
    ['null ip_location_display', 'ip_location_display', null],
    ['null referer', 'referer', null],
    ['null user_agent', 'user_agent', null],
    ['null user_agent_display', 'user_agent_display', null],
  ])(
    'rejects changes to submission fields on update (%s)',
    async (_name, field, value) => {
      actingAs(user);

      const target = await entry({ starred: false });
      const only = (resource: EntryBody) =>
        Object.fromEntries(
          SUBMISSION_FIELDS.map((key) => [key, resource[key]]),
        );
      const original = only(await freshJson(target));

      const res = await send('put', `/api/v1/entries/${target.id}`, {
        spam_score: 0,
        starred: true,
        [field]: value,
      });

      expectValidationError(res, field);
      const after = await freshJson(target);
      expect(only(after)).toStrictEqual(original);
      expect(after.starred).toBe(false);
    },
  );

  it('forbids updating an entry on a form the user does not own', async () => {
    actingAs(await t.factories.user());

    const target = await entry({ starred: false });

    const res = await send('put', `/api/v1/entries/${target.id}`, {
      spam_score: 0,
      starred: true,
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'You do not own this form.' });

    expect(((await fresh(target)) as FormEntry).starred).toBe(false);
  });

  it('soft deletes an entry', async () => {
    actingAs(user);

    const target = await entry();

    const res = await send('delete', `/api/v1/entries/${target.id}`);

    expect(res.status).toBe(204);
    expect(((await fresh(target)) as FormEntry).deletedAt).not.toBeNull();
  });

  it('restores a soft deleted entry', async () => {
    actingAs(user);

    const target = await entry();
    await softDelete(target);

    const res = await send('post', `/api/v1/entries/${target.id}/restore`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { id: target.id, deleted_at: null },
    });
    expect(((await fresh(target)) as FormEntry).deletedAt).toBeNull();
  });

  it('permanently deletes an entry that is already deleted', async () => {
    actingAs(user);

    const target = await entry();
    await softDelete(target);

    const res = await send('delete', `/api/v1/entries/${target.id}/force`);

    expect(res.status).toBe(204);
    expect(await fresh(target)).toBeNull();
  });

  it('refuses to permanently delete an entry that is not deleted', async () => {
    actingAs(user);

    const target = await entry();

    const res = await send('delete', `/api/v1/entries/${target.id}/force`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: 'Only deleted entries can be permanently deleted.',
    });
    expect(((await fresh(target)) as FormEntry).deletedAt).toBeNull();
  });

  it.each([
    ['delete', 'delete', '', false],
    ['restore', 'post', '/restore', true],
    ['force delete', 'delete', '/force', true],
  ] as const)(
    'forbids deleting, restoring or permanently deleting an entry on a form the user does not own (%s)',
    async (_name, method, suffix, trashed) => {
      actingAs(await t.factories.user());

      const target = await entry();
      if (trashed) await softDelete(target);

      const res = await send(method, `/api/v1/entries/${target.id}${suffix}`);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ message: 'You do not own this form.' });

      expect(((await fresh(target)) as FormEntry).deletedAt !== null).toBe(
        trashed,
      );
    },
  );

  it('forbids access to entries of a deleted form', async () => {
    actingAs(user);

    const target = await entry();
    await softDelete(form);

    const res = await get(`/api/v1/entries/${target.id}`);

    expect(res.status).toBe(403);
  });

  it.each([
    ['with', 'with', ['kept', 'deleted']],
    ['only', 'only', ['deleted']],
  ])(
    'lists deleted entries with the trashed filter (%s)',
    async (_name, value, expectedKeys) => {
      actingAs(user);

      const created: Record<string, FormEntry> = {};
      travelTo('2026-01-01');
      created.kept = await entry();
      travelTo('2026-01-02');
      created.deleted = await entry();
      await softDelete(created.deleted);

      const res = await get(
        `/api/v1/forms/${form.id}/entries?filter[trashed]=${value}`,
      );

      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(expectedKeys.map((key) => created[key].id));
    },
  );

  it.each([
    ['mark_read', { readAt: null }, 'read_at', '2026-01-01T00:00:00.000000Z'],
    [
      'mark_unread',
      { readAt: new Date('2026-01-01T00:00:00Z') },
      'read_at',
      null,
    ],
    ['star', { starred: false }, 'starred', true],
    ['unstar', { starred: true }, 'starred', false],
    ['mark_spam', { spam: null }, 'spam', true],
    ['mark_not_spam', { spam: true }, 'spam', false],
  ] as const)(
    'applies a bulk triage action to the selected entries (%s)',
    async (action, before, attribute, expected) => {
      actingAs(user);
      travelTo('2026-01-01 00:00:00');

      const selected = [await entry(before), await entry(before)];
      const untouched = await entry(before);
      const untouchedValue = (await freshJson(untouched))[attribute];

      const res = await send('post', `/api/v1/forms/${form.id}/entries/bulk`, {
        action,
        ids: selected.map((e) => e.id),
      });

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({ data: { action, affected: 2 } });

      for (const e of selected) {
        expect((await freshJson(e))[attribute]).toBe(expected);
      }
      expect((await freshJson(untouched))[attribute]).toBe(untouchedValue);
    },
  );

  it('keeps existing read times and counts only changed entries when bulk marking read', async () => {
    actingAs(user);

    const alreadyRead = await entry({
      readAt: new Date('2025-06-01T00:00:00Z'),
    });
    const unread = await entry({ readAt: null });

    const res = await send('post', `/api/v1/forms/${form.id}/entries/bulk`, {
      action: 'mark_read',
      ids: [alreadyRead.id, unread.id],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { affected: 1 } });

    expect((await freshJson(alreadyRead)).read_at).toBe(
      '2025-06-01T00:00:00.000000Z',
    );
    expect((await freshJson(unread)).read_at).not.toBeNull();
  });

  it('bulk deletes, restores and permanently deletes entries', async () => {
    actingAs(user);

    const created = [await entry(), await entry()];
    const entryIds = created.map((e) => e.id);
    const bulk = (action: string) =>
      send('post', `/api/v1/forms/${form.id}/entries/bulk`, {
        action,
        ids: entryIds,
      });

    expect((await bulk('delete')).body).toMatchObject({
      data: { affected: 2 },
    });
    for (const e of created) {
      expect(((await fresh(e)) as FormEntry).deletedAt).not.toBeNull();
    }

    expect((await bulk('restore')).body).toMatchObject({
      data: { affected: 2 },
    });
    for (const e of created) {
      expect(((await fresh(e)) as FormEntry).deletedAt).toBeNull();
    }

    for (const e of created) await softDelete(e);

    expect((await bulk('force_delete')).body).toMatchObject({
      data: { affected: 2 },
    });
    for (const e of created) expect(await fresh(e)).toBeNull();
  });

  it.each([
    ['entry from another form', 'delete', () => t.factories.entry(), 'ids.0'],
    [
      'deleted entry for a triage action',
      'star',
      async () => {
        const e = await entry();
        await softDelete(e);
        return e;
      },
      'ids.0',
    ],
    ['live entry for force delete', 'force_delete', () => entry(), 'ids.0'],
    ['unknown action', 'archive', () => entry(), 'action'],
  ])(
    'rejects a bulk request with entries that are not eligible (%s)',
    async (_name, action, makeEntry, errorKey) => {
      actingAs(user);
      const target = await makeEntry();

      const res = await send('post', `/api/v1/forms/${form.id}/entries/bulk`, {
        action,
        ids: [target.id],
      });

      expectValidationError(res, errorKey);
      expect(await fresh(target)).not.toBeNull();
    },
  );

  it.each([
    ['none', 0],
    ['over the limit', 101],
  ])(
    'rejects a bulk request with too many or no entries (%s)',
    async (_name, count) => {
      actingAs(user);

      const res = await send('post', `/api/v1/forms/${form.id}/entries/bulk`, {
        action: 'star',
        ids: Array.from({ length: count }, () => ulid()),
      });

      expectValidationError(res, 'ids');
    },
  );

  it('forbids bulk actions on a form the user does not own', async () => {
    actingAs(await t.factories.user());

    const target = await entry();

    const res = await send('post', `/api/v1/forms/${form.id}/entries/bulk`, {
      action: 'delete',
      ids: [target.id],
    });

    expect(res.status).toBe(403);
    expect(((await fresh(target)) as FormEntry).deletedAt).toBeNull();
  });
});
