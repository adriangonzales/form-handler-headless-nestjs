import request from 'supertest';
import { formStates } from '../../src/database/factories/factories';
import { Form } from '../../src/forms/form.entity';
import type { User } from '../../src/users/user.entity';
import { createApp, type TestApp } from '../support/create-app';
import { probeImports } from '../support/probe.module';
import {
  body,
  json,
  validationErrorKeys,
  type ErrorBody,
} from '../support/json-request';

interface FormData {
  id: string;
  name: string;
  active: boolean;
  schema: unknown[] | null;
  settings: Record<string, unknown> | null;
  entries_count?: unknown;
  unread_entries_count?: unknown;
  spam_entries_count?: unknown;
  updated_at: string;
}

interface ListBody {
  data: FormData[];
  links: Record<'first' | 'last' | 'prev' | 'next', string | null>;
  meta: { current_page: number; total: number };
}

const FIELD_ID = '01K6E2E0000000000000000001';
const DEFAULTS = {
  redirect: null,
  timezone: null,
  domains: [],
  message: null,
  honeypot_enabled: false,
  honeypot_name: null,
};

/** Forms behaviour the Pest suite doesn't cover (ch. 7 §7.3, ch. 4 §4.5). */
describe('Forms (port-specific)', () => {
  let t: TestApp;
  let user: User;
  let token: string;

  beforeEach(async () => {
    t = await createApp();
    user = await t.factories.user();
    token = await t.apiToken(user);
  });

  afterEach(async () => {
    await t.close();
  });

  const forms = () => t.dataSource.getRepository(Form);
  const fresh = (id: string) =>
    forms().findOneOrFail({ where: { id }, withDeleted: true });
  const call = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    data?: object,
  ) => json(t.http, method, url, data, token);
  const store = (data: object) => call('post', '/api/v1/forms', data);
  const own = (overrides: Partial<Form> = {}) =>
    t.factories.form({ userId: user.id, ...overrides });

  describe('F7: rule names are checked on save', () => {
    it('rejects a misspelt rule on schema.N.rules', async () => {
      const res = await store({
        name: 'Contact',
        schema: [{ id: FIELD_ID, order: 1, rules: ['requird'] }],
      });

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res)).toEqual({
        message:
          'The schema.0.rules field contains an unsupported rule: requird.',
        errors: {
          'schema.0.rules': [
            'The schema.0.rules field contains an unsupported rule: requird.',
          ],
        },
      });
    });

    it('rejects the stray part of "in:a,b" written as a string', async () => {
      const res = await store({
        name: 'Contact',
        schema: [{ id: FIELD_ID, order: 1, rules: 'required,in:a,b' }],
      });

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).errors['schema.0.rules']).toEqual([
        'The schema.0.rules field contains an unsupported rule: b.',
      ]);
    });

    it('accepts supported rules in any case, with parameters and spaces', async () => {
      const res = await store({
        name: 'Contact',
        schema: [
          { id: FIELD_ID, order: 1, rules: ['in:a,b', 'REQUIRED', 'Int'] },
          {
            id: '01K6E2E0000000000000000002',
            order: 2,
            rules: 'required, email,max:255',
          },
          { id: '01K6E2E0000000000000000003', order: 3, rules: null },
        ],
      });

      expect(res.status).toBe(201);
    });

    it('lists each unsupported rule once, on the right field', async () => {
      const res = await store({
        name: 'Contact',
        schema: [
          { id: FIELD_ID, order: 1, rules: ['required'] },
          {
            id: '01K6E2E0000000000000000002',
            order: 2,
            rules: ['exists:users,email', 'foo', 'foo:1'],
          },
        ],
      });

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).errors).toEqual({
        'schema.1.rules': [
          'The schema.1.rules field contains an unsupported rule: exists.',
          'The schema.1.rules field contains an unsupported rule: foo.',
        ],
      });
    });

    it('only checks fields that passed the structural rules', async () => {
      const res = await store({
        name: 'Contact',
        schema: [{ id: 'nope', order: 1, rules: ['requird'] }],
      });

      expect(res.status).toBe(422);
      expect(validationErrorKeys(res.body)).toEqual(['schema.0.id']);
    });

    it('checks rules on update too', async () => {
      const form = await own();

      const res = await call('put', `/api/v1/forms/${form.id}`, {
        name: form.name,
        active: true,
        schema: [{ id: FIELD_ID, order: 1, rules: ['requird'] }],
      });

      expect(res.status).toBe(422);
      expect(validationErrorKeys(res.body)).toEqual(['schema.0.rules']);
    });
  });

  describe('resource shape', () => {
    it('returns all six settings for a stored row missing some', async () => {
      const form = await own({ settings: { redirect: 'https://x.test' } });

      const res = await call('get', `/api/v1/forms/${form.id}`);

      expect(body<{ data: FormData }>(res).data.settings).toEqual({
        ...DEFAULTS,
        redirect: 'https://x.test',
      });
      expect(Object.keys(body<{ data: FormData }>(res).data)).toEqual([
        'id',
        'user_id',
        'name',
        'active',
        'schema',
        'settings',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
    });

    it('keeps null schema and settings as null', async () => {
      const res = await store({ name: 'Bare' });

      expect(res.status).toBe(201);
      expect(body<{ data: FormData }>(res).data).toMatchObject({
        schema: null,
        settings: null,
      });
    });

    it('stores {} settings with every default', async () => {
      const res = await store({ name: 'Defaults', settings: {} });

      expect(body<{ data: FormData }>(res).data.settings).toEqual(DEFAULTS);
      const stored = await fresh(body<{ data: FormData }>(res).data.id);
      expect(stored.settings).toEqual(DEFAULTS);
    });

    it('places the counts after settings, as numbers, in the list only', async () => {
      const form = await own();
      await t.factories.entry({ formId: form.id, spam: false, readAt: null });

      const res = await call('get', '/api/v1/forms');

      const [item] = body<ListBody>(res).data;
      expect(Object.keys(item)).toEqual([
        'id',
        'user_id',
        'name',
        'active',
        'schema',
        'settings',
        'entries_count',
        'unread_entries_count',
        'spam_entries_count',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
      expect(item.entries_count).toBe(1);
      expect(item.unread_entries_count).toBe(1);
      expect(item.spam_entries_count).toBe(0);
    });
  });

  describe('create and update input', () => {
    it('ignores user_id and active on create', async () => {
      const other = await t.factories.user();

      const res = await store({
        name: 'Mine',
        user_id: other.id,
        active: true,
      });

      expect(res.status).toBe(201);
      expect(body<{ data: FormData }>(res).data).toMatchObject({
        user_id: user.id,
        active: false,
      });
    });

    it('stores an urlencoded schema as a list, with string values kept', async () => {
      const res = await request(t.http)
        .post('/api/v1/forms')
        .set('Authorization', `Bearer ${token}`)
        .type('form')
        .send(
          `name=+Contact+&schema[0][id]=${FIELD_ID}&schema[0][order]=1&schema[0][rules][]=required&settings[honeypot_enabled]=1&settings[honeypot_name]=trap&settings[domains][]=example.com`,
        );

      expect(res.status).toBe(201);
      const stored = await fresh(body<{ data: FormData }>(res).data.id);
      expect(stored.name).toBe('Contact');
      expect(stored.schema).toEqual([
        { id: FIELD_ID, order: '1', rules: ['required'] },
      ]);
      expect(stored.settings).toEqual({
        ...DEFAULTS,
        domains: ['example.com'],
        honeypot_enabled: true,
        honeypot_name: 'trap',
      });
    });

    it('requires name and active on PATCH as well as PUT', async () => {
      const form = await own();

      const res = await call('patch', `/api/v1/forms/${form.id}`, {
        name: 'Renamed',
      });

      expect(res.status).toBe(422);
      expect(validationErrorKeys(res.body)).toEqual(['active']);

      const ok = await call('patch', `/api/v1/forms/${form.id}`, {
        name: 'Renamed',
        active: '1',
      });
      expect(ok.status).toBe(200);
      expect(body<{ data: FormData }>(ok).data).toMatchObject({
        name: 'Renamed',
        active: true,
      });
    });

    it('keeps an omitted schema and settings, and clears them with null', async () => {
      const schema = [{ id: FIELD_ID, order: 1 }];
      const form = await own({ schema, settings: { message: 'Hi' } });

      await call('put', `/api/v1/forms/${form.id}`, {
        name: form.name,
        active: false,
      }).expect(200);
      expect(await fresh(form.id)).toMatchObject({
        schema,
        settings: { message: 'Hi' },
      });

      await call('put', `/api/v1/forms/${form.id}`, {
        name: form.name,
        active: false,
        schema: null,
        settings: null,
      }).expect(200);
      expect(await fresh(form.id)).toMatchObject({
        schema: null,
        settings: null,
      });
    });

    it('leaves updated_at alone when nothing changed', async () => {
      const form = await own({ ...formStates.active, name: 'Same' });
      t.clock.travel(60_000);

      const res = await call('put', `/api/v1/forms/${form.id}`, {
        name: 'Same',
        active: true,
      });

      expect(body<{ data: FormData }>(res).data.updated_at).toBe(
        '2026-01-01T00:00:00.000000Z',
      );
    });

    it('generates a honeypot name that avoids the schema input names', async () => {
      const res = await store({
        name: 'Contact',
        schema: [{ id: FIELD_ID, order: 1, name: 'website_abc123' }],
        settings: { honeypot_enabled: '1' },
      });

      expect(res.status).toBe(201);
      const settings = body<{ data: FormData }>(res).data.settings;
      expect(settings?.honeypot_enabled).toBe(true);
      expect(settings?.honeypot_name).toMatch(
        /^(website|homepage|url|company)_[a-z0-9]{6}$/,
      );
    });

    it('replaces a stored honeypot name that clashes with the new schema', async () => {
      const form = await own({
        settings: { honeypot_enabled: true, honeypot_name: 'website_abc123' },
      });

      const res = await call('put', `/api/v1/forms/${form.id}`, {
        name: form.name,
        active: true,
        schema: [{ id: FIELD_ID, order: 1, name: 'website_abc123' }],
        settings: { honeypot_enabled: true },
      });

      expect(res.status).toBe(200);
      const name = body<{ data: FormData }>(res).data.settings?.honeypot_name;
      expect(name).not.toBe('website_abc123');
      expect(name).toMatch(/^(website|homepage|url|company)_[a-z0-9]{6}$/);
    });

    it('reports every error in Laravel key order', async () => {
      // Captured from the reference app (test/fixtures/laravel/http/captured.json).
      const res = await store({
        schema: [{ id: 'nope', order: 'x' }],
        settings: { bogus: 1 },
      });

      expect(res.status).toBe(422);
      expect(Object.entries(body<ErrorBody>(res))).toEqual(
        Object.entries({
          message: 'The name field is required. (and 3 more errors)',
          errors: {
            name: ['The name field is required.'],
            settings: ['The settings field must be an array.'],
            'schema.0.id': ['The schema.0.id field must be a valid ULID.'],
            'schema.0.order': ['The schema.0.order field must be an integer.'],
          },
        }),
      );
      expect(Object.keys(body<ErrorBody>(res).errors)).toEqual([
        'name',
        'settings',
        'schema.0.id',
        'schema.0.order',
      ]);
    });
  });

  describe('check order and bindings', () => {
    it('gives a non-owner 403 even when the body is invalid', async () => {
      const form = await t.factories.form();

      const res = await call('put', `/api/v1/forms/${form.id}`, {});

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'You do not own this form.' });
    });

    it('gives an unknown ID 404 before any ownership check', async () => {
      const res = await call(
        'put',
        '/api/v1/forms/01k6b6xz0000000000000000zz',
        {},
      );

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        message:
          'No query results for model [App\\Models\\Form] 01k6b6xz0000000000000000zz',
      });
    });

    it('gives 401 before 404', async () => {
      const res = await json(t.http, 'get', '/api/v1/forms/not-a-ulid');

      expect(res.status).toBe(401);
    });

    it('matches IDs exactly: invalid and uppercase ULIDs are 404', async () => {
      const form = await own();

      for (const id of ['not-a-ulid', form.id.toUpperCase()]) {
        const res = await call('get', `/api/v1/forms/${id}`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({
          message: `No query results for model [App\\Models\\Form] ${id}`,
        });
      }
    });

    it('hides a deleted form from every route but restore', async () => {
      const form = await own();
      await call('delete', `/api/v1/forms/${form.id}`).expect(204);

      for (const [method, url] of [
        ['get', `/api/v1/forms/${form.id}`],
        ['put', `/api/v1/forms/${form.id}`],
        ['patch', `/api/v1/forms/${form.id}`],
        ['delete', `/api/v1/forms/${form.id}`],
        ['post', `/api/v1/forms/${form.id}/duplicate`],
      ] as const) {
        expect((await call(method, url, {})).status).toBe(404);
      }
      expect(
        body<ListBody>(await call('get', '/api/v1/forms')).meta.total,
      ).toBe(0);

      await call('post', `/api/v1/forms/${form.id}/restore`).expect(200);
      await call('get', `/api/v1/forms/${form.id}`).expect(200);
    });

    it('answers a wrong method on a form with 405 and Allow', async () => {
      const form = await own();

      const res = await call('post', `/api/v1/forms/${form.id}`);

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD, PUT, PATCH, DELETE');
    });
  });

  describe('delete and restore timestamps', () => {
    it('sets updated_at with deleted_at, and restoring a live form changes nothing', async () => {
      const form = await own();
      t.clock.travel(60_000);

      const restored = await call('post', `/api/v1/forms/${form.id}/restore`);
      expect(body<{ data: FormData }>(restored).data.updated_at).toBe(
        '2026-01-01T00:00:00.000000Z',
      );

      await call('delete', `/api/v1/forms/${form.id}`).expect(204);
      const deleted = await fresh(form.id);
      expect(deleted.deletedAt?.toISOString()).toBe('2026-01-01T00:01:00.000Z');
      expect(deleted.updatedAt.toISOString()).toBe('2026-01-01T00:01:00.000Z');

      t.clock.travel(60_000);
      const res = await call('post', `/api/v1/forms/${form.id}/restore`);
      expect(body<{ data: FormData }>(res).data).toMatchObject({
        deleted_at: null,
        updated_at: '2026-01-01T00:02:00.000000Z',
      });
    });
  });

  describe('list', () => {
    it('pages with ?page=2 and keeps the filter in links, page last', async () => {
      for (let i = 0; i < 16; i++) await own(formStates.active);

      const res = await call(
        'get',
        '/api/v1/forms?filter[active]=true&per_page=15&page=2',
      );

      const list = body<ListBody>(res);
      expect(list.meta.current_page).toBe(2);
      expect(list.data).toHaveLength(1);
      expect(list.links.prev).toMatch(
        /\/api\/v1\/forms\?filter%5Bactive%5D=true&per_page=15&page=1$/,
      );
    });

    it.each(['abc', '0', '-1'])('treats ?page=%s as page 1', async (page) => {
      await own();

      const res = await call('get', `/api/v1/forms?page=${page}`);

      expect(res.status).toBe(200);
      expect(body<ListBody>(res).meta.current_page).toBe(1);
      expect(body<ListBody>(res).data).toHaveLength(1);
    });

    it('sorts names by lower(name) in byte order', async () => {
      for (const name of ['banana', 'Éclair', 'apple', '_under', 'Zebra']) {
        await own({ name });
      }

      const res = await call('get', '/api/v1/forms?sort=name');

      expect(body<ListBody>(res).data.map((f) => f.name)).toEqual([
        '_under',
        'apple',
        'banana',
        'Zebra',
        'Éclair',
      ]);
    });

    it('breaks ties by id in the same direction', async () => {
      const a = await own({ name: 'Same' });
      const b = await own({ name: 'Same' });
      const [first, second] = [a.id, b.id].sort();

      const asc = await call('get', '/api/v1/forms?sort=name');
      const desc = await call('get', '/api/v1/forms?sort=-name');

      expect(body<ListBody>(asc).data.map((f) => f.id)).toEqual([
        first,
        second,
      ]);
      expect(body<ListBody>(desc).data.map((f) => f.id)).toEqual([
        second,
        first,
      ]);
    });

    it('rejects a null sort and a non-array filter', async () => {
      const res = await call('get', '/api/v1/forms?sort=&filter=x');

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).errors).toEqual({
        sort: [
          'The sort field must be a string.',
          'The selected sort is invalid.',
        ],
        filter: ['The filter field must be an array.'],
      });
    });
  });
});

/**
 * `FormOwnershipGuard` on the shallow child routes (ch. 3 §3.3), through
 * test-only probe routes until entries, notifications and exports land.
 */
describe('FormOwnershipGuard on child models', () => {
  let t: TestApp;
  let user: User;
  let token: string;

  beforeEach(async () => {
    t = await createApp({ imports: probeImports });
    user = await t.factories.user();
    token = await t.apiToken(user);
  });

  afterEach(async () => {
    await t.close();
  });

  const get = (url: string) => json(t.http, 'get', url, undefined, token);
  const softDelete = (target: { constructor: unknown; id: string }) =>
    t.dataSource
      .getRepository(target.constructor as typeof Form)
      .update({ id: target.id }, { deletedAt: t.clock.now() });

  it('binds an entry, notification and export of an owned form', async () => {
    const form = await t.factories.form({ userId: user.id });
    const entry = await t.factories.entry({ formId: form.id });
    const notification = await t.factories.notification({ formId: form.id });
    const entryExport = await t.factories.entryExport({ formId: form.id });

    for (const [path, id] of [
      ['entries', entry.id],
      ['notifications', notification.id],
      ['exports', entryExport.id],
    ]) {
      const res = await get(`/api/v1/probe-owned/${path}/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id, form: form.id });
    }
  });

  it("gives 403 for another user's child", async () => {
    const entry = await t.factories.entry();

    const res = await get(`/api/v1/probe-owned/entries/${entry.id}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'You do not own this form.' });
  });

  it('gives 403, not 404, for a child of a deleted form', async () => {
    const form = await t.factories.form({ userId: user.id });
    const entry = await t.factories.entry({ formId: form.id });
    const notification = await t.factories.notification({ formId: form.id });
    const entryExport = await t.factories.entryExport({ formId: form.id });
    await softDelete(form);

    for (const [path, id] of [
      ['entries', entry.id],
      ['notifications', notification.id],
      ['exports', entryExport.id],
    ]) {
      const res = await get(`/api/v1/probe-owned/${path}/${id}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'You do not own this form.' });
    }
  });

  it('gives 404 for a deleted child unless the route is withTrashed', async () => {
    const form = await t.factories.form({ userId: user.id });
    const entry = await t.factories.entry({ formId: form.id });
    await softDelete(entry);

    const res = await get(`/api/v1/probe-owned/entries/${entry.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      message: `No query results for model [App\\Models\\FormEntry] ${entry.id}`,
    });

    const restore = await json(
      t.http,
      'post',
      `/api/v1/probe-owned/entries/${entry.id}/restore`,
      {},
      token,
    );
    expect(restore.status).toBe(200);
  });

  it('names the model in 404s for unknown IDs', async () => {
    for (const [path, model] of [
      ['notifications', 'FormNotification'],
      ['exports', 'FormEntryExport'],
    ]) {
      const res = await get(`/api/v1/probe-owned/${path}/nope`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        message: `No query results for model [App\\Models\\${model}] nope`,
      });
    }
  });
});
