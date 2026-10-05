import { faker } from '@faker-js/faker';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FormEntry } from '../../../../src/form-entries/form-entry.entity';
import { FormCreated } from '../../../../src/events/form-created.event';
import {
  formStates,
  withBasicSchema,
} from '../../../../src/database/factories/factories';
import type { FormField } from '../../../../src/forms/form-field';
import { withSettingsDefaults } from '../../../../src/forms/form-settings';
import { Form } from '../../../../src/forms/form.entity';
import type { User } from '../../../../src/users/user.entity';
import { createApp, type TestApp } from '../../../support/create-app';
import {
  body,
  json,
  validationErrorKeys,
  type ErrorBody,
} from '../../../support/json-request';

interface FormBody {
  id: string;
  user_id: number;
  name: string;
  active: boolean;
  schema: FormField[] | null;
  settings: Record<string, unknown> | null;
  entries_count?: number;
  unread_entries_count?: number;
  spam_entries_count?: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface FormListBody {
  data: FormBody[];
  links: Record<'first' | 'last' | 'prev' | 'next', string | null>;
  meta: { current_page: number; per_page: number; last_page: number };
}

const FIELD_ID = '01K6E2E0000000000000000001';

/** Port of `tests/Feature/Http/Controllers/FormControllerTest.php` (41). */
describe('FormControllerTest', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createApp();
  });

  afterEach(async () => {
    await t.close();
  });

  const forms = () => t.dataSource.getRepository(Form);
  const fresh = (form: Form) =>
    forms().findOneOrFail({ where: { id: form.id }, withDeleted: true });
  /** `$model->touch()`. */
  const touch = (form: Form) =>
    forms().update({ id: form.id }, { updatedAt: t.clock.now() });
  /** `$model->delete()` on a soft-deleting model. */
  const softDelete = (target: Form | FormEntry) =>
    t.dataSource
      .getRepository(target.constructor)
      .update({ id: target.id }, { deletedAt: t.clock.now() });
  /** `$this->travelTo($date)`. */
  const travelTo = (date: string) => t.clock.set(`${date}Z`.replace(' ', 'T'));

  /**
   * `$this->actingAs($user)`. Laravel's version sets the guard's user, so
   * time travel can't expire it; here each request gets a token minted at
   * the current (fake) time.
   */
  let actor: User | undefined;
  const actingAs = (user: User) => {
    actor = user;
  };
  const token = async () =>
    actor === undefined ? undefined : t.apiToken(actor);
  const get = async (url: string) =>
    json(t.http, 'get', url, undefined, await token());
  const post = async (url: string, data?: object) =>
    json(t.http, 'post', url, data ?? {}, await token());
  const put = async (url: string, data: object) =>
    json(t.http, 'put', url, data, await token());
  const del = async (url: string) =>
    json(t.http, 'delete', url, undefined, await token());

  /** Pest's `Event::fake()` + `Event::assertDispatched(FormCreated::class)`. */
  const recordFormCreated = () => {
    const created: Form[] = [];
    t.app
      .get(EventEmitter2)
      .on(FormCreated.event, (event: FormCreated) => created.push(event.form));
    return created;
  };

  const expectValidationError = (
    res: { status: number; body: unknown },
    key: string,
  ) => {
    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toContain(key);
  };

  beforeEach(() => {
    actor = undefined;
  });

  it('requires authentication to view the form index', async () => {
    const res = await get('/api/v1/forms');

    expect(res.status).toBe(401);
  });

  it('lists results from the index', async () => {
    const user = await t.factories.user();
    await t.factories.form({ userId: user.id });

    const user2 = await t.factories.user();
    await t.factories.form({ userId: user2.id });

    actingAs(user);

    const res = await get('/api/v1/forms');

    expect(res.status).toBe(200);
    const list = body<FormListBody>(res);
    for (const item of list.data) {
      for (const key of [
        'id',
        'user_id',
        'name',
        'active',
        'schema',
        'settings',
        'created_at',
        'updated_at',
        'deleted_at',
      ]) {
        expect(item).toHaveProperty(key);
      }
    }
    for (const key of ['first', 'last', 'prev', 'next']) {
      expect(list.links).toHaveProperty(key);
    }
    expect(list.meta).toHaveProperty('current_page');
    expect(list.data).toHaveLength(1);
  });

  it('includes total, unread and spam entry counts in the index', async () => {
    const user = await t.factories.user();
    const form = await t.factories.form({ userId: user.id });
    const emptyForm = await t.factories.form({
      userId: user.id,
      createdAt: new Date(t.clock.now().getTime() + 60_000),
    });
    const now = t.clock.now();
    const entry = (readAt: Date | null, spam: boolean | null) =>
      t.factories.entry({ formId: form.id, readAt, spam });
    await entry(null, false);
    await entry(null, null);
    await entry(null, true);
    await entry(now, false);
    await entry(now, true);
    await softDelete(await entry(null, false));
    await softDelete(await entry(null, true));
    actingAs(user);

    const res = await get('/api/v1/forms');

    expect(res.status).toBe(200);
    const [first, second] = body<FormListBody>(res).data;
    expect(first.id).toBe(form.id);
    expect(first.entries_count).toBe(3);
    expect(first.unread_entries_count).toBe(2);
    expect(first.spam_entries_count).toBe(2);
    expect(second.id).toBe(emptyForm.id);
    expect(second.entries_count).toBe(0);
    expect(second.unread_entries_count).toBe(0);
    expect(second.spam_entries_count).toBe(0);
  });

  it('shows details of a form', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({ userId: user.id });

    const res = await get(`/api/v1/forms/${form.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        id: form.id,
        user_id: form.userId,
        name: form.name,
        active: form.active,
        schema: form.schema,
        settings: withSettingsDefaults(form.settings),
      },
    });
  });

  it('forbids viewing a form owned by another user', async () => {
    actingAs(await t.factories.user());

    const form = await t.factories.form();

    const res = await get(`/api/v1/forms/${form.id}`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'You do not own this form.' });
  });

  it('creates a new form', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const name = faker.person.fullName();
    const schema = [
      {
        id: FIELD_ID,
        order: 1,
        label: 'Email',
        name: 'email',
        rules: ['email', 'required'],
      },
    ];
    const settings = { redirect: faker.internet.url() };

    const created = recordFormCreated();

    const res = await post('/api/v1/forms', { name, schema, settings });

    expect(res.status).toBe(201);
    expect(body<{ data: FormBody }>(res).data.active).toBe(false);

    const found = await forms().findBy({ userId: user.id, name });

    expect(found).toHaveLength(1);
    const [form] = found;
    expect(form.schema).toStrictEqual(schema);
    expect(withSettingsDefaults(form.settings)).toStrictEqual({
      redirect: settings.redirect,
      timezone: null,
      domains: [],
      message: null,
      honeypot_enabled: false,
      honeypot_name: null,
    });

    expect(created.map((f) => f.id)).toContain(form.id);
  });

  it('rejects a JSON string schema when creating a form', async () => {
    actingAs(await t.factories.user());

    const res = await post('/api/v1/forms', {
      name: faker.person.fullName(),
      schema: JSON.stringify([{ id: FIELD_ID, order: 1, label: 'Email' }]),
    });

    expectValidationError(res, 'schema');
  });

  it.each([
    [
      'keyed by field ID',
      { [FIELD_ID]: { order: 1, label: 'Email' } },
      'schema',
    ],
    ['missing ID', [{ order: 1, label: 'Email' }], 'schema.0.id'],
    ['non-ULID ID', [{ id: 'email', order: 1 }], 'schema.0.id'],
    [
      'duplicate ID',
      [
        { id: FIELD_ID, order: 1 },
        { id: FIELD_ID, order: 2 },
      ],
      'schema.1.id',
    ],
    ['missing order', [{ id: FIELD_ID, label: 'Email' }], 'schema.0.order'],
    ['non-integer order', [{ id: FIELD_ID, order: 'first' }], 'schema.0.order'],
    [
      'unknown field key',
      [{ id: FIELD_ID, order: 1, type: 'text' }],
      'schema.0',
    ],
    [
      'non-string rule',
      [{ id: FIELD_ID, order: 1, rules: [['required']] }],
      'schema.0.rules.0',
    ],
  ])(
    'rejects an invalid schema when creating a form (%s)',
    async (_name, schema, errorKey) => {
      actingAs(await t.factories.user());

      const res = await post('/api/v1/forms', {
        name: faker.person.fullName(),
        schema,
      });

      expectValidationError(res, errorKey);
    },
  );

  it('returns schema fields sorted by order', async () => {
    const user = await t.factories.user();
    actingAs(user);
    const form = await t.factories.form({
      userId: user.id,
      schema: [
        {
          id: '01m3x339mch98t20fnxabkq1xs',
          order: 2,
          label: 'Email',
          name: 'email',
        },
        { id: FIELD_ID, order: 1, label: 'Name', name: 'name' },
      ],
    });

    const res = await get(`/api/v1/forms/${form.id}`);

    expect(res.status).toBe(200);

    expect(body<{ data: FormBody }>(res).data.schema).toStrictEqual([
      { id: FIELD_ID, order: 1, label: 'Name', name: 'name' },
      {
        id: '01m3x339mch98t20fnxabkq1xs',
        order: 2,
        label: 'Email',
        name: 'email',
      },
    ]);
  });

  it('updates a form', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({ userId: user.id });

    const name = faker.person.fullName();
    const active = faker.datatype.boolean();

    const res = await put(`/api/v1/forms/${form.id}`, { name, active });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { id: form.id, user_id: user.id, name, active },
    });

    const updated = await fresh(form);
    expect(updated.userId).toBe(user.id);
    expect(updated.name).toBe(name);
    expect(updated.active).toBe(active);
  });

  it.each(['banana', 'yes'])(
    'rejects a non-boolean active value when updating a form (%s)',
    async (active) => {
      const user = await t.factories.user();
      actingAs(user);

      const form = await t.factories.form({
        ...formStates.inactive,
        userId: user.id,
      });

      const res = await put(`/api/v1/forms/${form.id}`, {
        name: form.name,
        active,
      });

      expectValidationError(res, 'active');

      expect((await fresh(form)).active).toBe(false);
    },
  );

  it('forbids updating a form owned by another user', async () => {
    actingAs(await t.factories.user());

    const form = await t.factories.form();
    const originalName = form.name;

    const res = await put(`/api/v1/forms/${form.id}`, {
      name: faker.person.fullName(),
      active: true,
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'You do not own this form.' });
    expect((await fresh(form)).name).toBe(originalName);
  });

  it('soft deletes a form', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({ userId: user.id });

    const res = await del(`/api/v1/forms/${form.id}`);

    expect(res.status).toBe(204);
    expect((await fresh(form)).deletedAt).not.toBeNull();
    expect((await get(`/api/v1/forms/${form.id}`)).status).toBe(404);
  });

  it('forbids deleting a form owned by another user', async () => {
    actingAs(await t.factories.user());

    const form = await t.factories.form();

    const res = await del(`/api/v1/forms/${form.id}`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'You do not own this form.' });
    expect((await fresh(form)).deletedAt).toBeNull();
  });

  it('restores a soft deleted form', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({ userId: user.id });
    await softDelete(form);

    const res = await post(`/api/v1/forms/${form.id}/restore`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { id: form.id } });
    expect((await fresh(form)).deletedAt).toBeNull();
  });

  it('forbids restoring a form owned by another user', async () => {
    actingAs(await t.factories.user());

    const form = await t.factories.form();
    await softDelete(form);

    const res = await post(`/api/v1/forms/${form.id}/restore`);

    expect(res.status).toBe(403);
    expect((await fresh(form)).deletedAt).not.toBeNull();
  });

  it('duplicates a form as a new inactive form', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({
      ...formStates.active,
      schema: withBasicSchema(),
      userId: user.id,
      name: 'Contact Form',
      settings: { redirect: 'https://example.com/thanks' },
    });

    const created = recordFormCreated();

    const res = await post(`/api/v1/forms/${form.id}/duplicate`);

    expect(res.status).toBe(201);

    const others = (await forms().find()).filter((f) => f.id !== form.id);
    expect(others).toHaveLength(1);
    const [copy] = others;
    expect(res.body).toMatchObject({
      data: {
        id: copy.id,
        user_id: user.id,
        name: 'Contact Form (copy)',
        active: false,
        schema: form.schema,
        settings: withSettingsDefaults(form.settings),
      },
    });

    expect(created.map((f) => f.id)).toEqual([copy.id]);
  });

  it('keeps a duplicated form name within the length limit', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({
      userId: user.id,
      name: 'a'.repeat(400),
    });

    const res = await post(`/api/v1/forms/${form.id}/duplicate`);

    expect(res.status).toBe(201);
    const name = body<{ data: FormBody }>(res).data.name;
    expect(name).toHaveLength(400);
    expect(name.endsWith(' (copy)')).toBe(true);
  });

  it('forbids duplicating a form owned by another user', async () => {
    actingAs(await t.factories.user());

    const form = await t.factories.form();

    const res = await post(`/api/v1/forms/${form.id}/duplicate`);

    expect(res.status).toBe(403);
    expect(await forms().count()).toBe(1);
  });

  it('stores and returns every form setting', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const settings = {
      redirect: 'https://example.com/thanks',
      timezone: 'America/Chicago',
      domains: ['example.com', '*.example.org'],
      message: 'Thanks, we will be in touch.',
      honeypot_enabled: true,
      honeypot_name: 'website',
    };

    const res = await post('/api/v1/forms', {
      name: faker.person.fullName(),
      settings,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ data: { settings } });

    const [form] = await forms().findBy({ userId: user.id });
    expect(withSettingsDefaults(form.settings)).toStrictEqual(settings);
  });

  it('fills in defaults for omitted form settings', async () => {
    actingAs(await t.factories.user());

    const res = await post('/api/v1/forms', {
      name: faker.person.fullName(),
      settings: { timezone: 'UTC' },
    });

    expect(res.status).toBe(201);

    expect(body<{ data: FormBody }>(res).data.settings).toStrictEqual({
      redirect: null,
      timezone: 'UTC',
      domains: [],
      message: null,
      honeypot_enabled: false,
      honeypot_name: null,
    });
  });

  it.each([
    ['unknown key', { captcha: 'recaptcha' }, 'settings'],
    ['redirect is not a url', { redirect: 'not a url' }, 'settings.redirect'],
    [
      'redirect is too long',
      { redirect: `https://example.com/${'a'.repeat(2048)}` },
      'settings.redirect',
    ],
    [
      'unknown timezone',
      { timezone: 'Mars/Olympus_Mons' },
      'settings.timezone',
    ],
    [
      'domains is not a list',
      { domains: { primary: 'example.com' } },
      'settings.domains',
    ],
    [
      'domain is not a hostname',
      { domains: ['https://example.com/path'] },
      'settings.domains.0',
    ],
    ['domain is not a string', { domains: [123] }, 'settings.domains.0'],
    ['message is too long', { message: 'a'.repeat(2001) }, 'settings.message'],
    [
      'honeypot enabled is not a boolean',
      { honeypot_enabled: 'yes please' },
      'settings.honeypot_enabled',
    ],
    [
      'honeypot name is not a field name',
      { honeypot_enabled: true, honeypot_name: 'contact.website' },
      'settings.honeypot_name',
    ],
  ])(
    'rejects invalid form settings (%s)',
    async (_name, settings, errorKey) => {
      actingAs(await t.factories.user());

      const res = await post('/api/v1/forms', {
        name: faker.person.fullName(),
        settings,
      });

      expectValidationError(res, errorKey);
    },
  );

  it.each([
    ['omitted', null],
    ['empty', ''],
  ])(
    'generates a honeypot name when the honeypot is enabled without one (%s)',
    async (_name, honeypotName) => {
      const user = await t.factories.user();
      actingAs(user);

      const res = await post('/api/v1/forms', {
        name: faker.person.fullName(),
        settings: { honeypot_enabled: true, honeypot_name: honeypotName },
      });

      expect(res.status).toBe(201);

      const [form] = await forms().findBy({ userId: user.id });
      const generatedName = withSettingsDefaults(form.settings).honeypot_name;
      expect(generatedName).toMatch(
        /^(website|homepage|url|company)_[a-z0-9]{6}$/,
      );
      expect(body<{ data: FormBody }>(res).data.settings?.honeypot_name).toBe(
        generatedName,
      );
    },
  );

  it('does not generate a honeypot name when the honeypot is disabled', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const res = await post('/api/v1/forms', {
      name: faker.person.fullName(),
      settings: { honeypot_enabled: false },
    });
    expect(res.status).toBe(201);

    const [form] = await forms().findBy({ userId: user.id });
    expect(withSettingsDefaults(form.settings).honeypot_name).toBeNull();
  });

  it('keeps the stored honeypot name when settings are updated without one', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({
      userId: user.id,
      settings: { honeypot_enabled: true, honeypot_name: 'website_abc123' },
    });

    const res = await put(`/api/v1/forms/${form.id}`, {
      name: form.name,
      active: true,
      settings: { honeypot_enabled: true, message: 'Thanks!' },
    });
    expect(res.status).toBe(200);

    expect(
      withSettingsDefaults((await fresh(form)).settings).honeypot_name,
    ).toBe('website_abc123');
  });

  it.each([
    ['field ID', [{ id: FIELD_ID, order: 1, label: 'Website' }], FIELD_ID],
    [
      'field name override',
      [{ id: FIELD_ID, order: 1, name: 'website', label: 'Website' }],
      'website',
    ],
  ])(
    'rejects a honeypot name that matches a schema field when creating a form (%s)',
    async (_name, schema, honeypotName) => {
      actingAs(await t.factories.user());

      const res = await post('/api/v1/forms', {
        name: faker.person.fullName(),
        schema,
        settings: { honeypot_enabled: true, honeypot_name: honeypotName },
      });

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).errors['settings.honeypot_name']).toContain(
        'The honeypot name must not match a schema field.',
      );
    },
  );

  it('accepts a honeypot name that only matches an overridden field ID', async () => {
    actingAs(await t.factories.user());

    const res = await post('/api/v1/forms', {
      name: faker.person.fullName(),
      schema: [{ id: FIELD_ID, order: 1, name: 'url', label: 'Website' }],
      settings: { honeypot_enabled: true, honeypot_name: FIELD_ID },
    });

    expect(res.status).toBe(201);
  });

  it.each([
    [
      'new settings clash with stored schema',
      {
        schema: [{ id: FIELD_ID, order: 1, name: 'website', label: 'Website' }],
      },
      { settings: { honeypot_enabled: true, honeypot_name: 'website' } },
      'settings.honeypot_name',
    ],
    [
      'new schema clashes with stored settings',
      { settings: { honeypot_enabled: true, honeypot_name: 'website' } },
      {
        schema: [{ id: FIELD_ID, order: 1, name: 'website', label: 'Website' }],
      },
      'schema',
    ],
  ])(
    'checks the honeypot name against the stored schema or settings when updating a form (%s)',
    async (_name, stored, sent, errorKey) => {
      const user = await t.factories.user();
      actingAs(user);

      const form = await t.factories.form({ userId: user.id, ...stored });

      const res = await put(`/api/v1/forms/${form.id}`, {
        name: form.name,
        active: true,
        ...sent,
      });

      expectValidationError(res, errorKey);
    },
  );

  it('validates settings when updating a form', async () => {
    const user = await t.factories.user();
    actingAs(user);

    const form = await t.factories.form({ userId: user.id });

    const res = await put(`/api/v1/forms/${form.id}`, {
      name: form.name,
      active: true,
      settings: { redirect: 'not a url' },
    });

    expectValidationError(res, 'settings.redirect');
  });

  it('includes timestamps in the form resource', async () => {
    const user = await t.factories.user();
    actingAs(user);

    travelTo('2026-01-02 03:04:05');
    const form = await t.factories.form({ userId: user.id });

    travelTo('2026-02-03 04:05:06');
    await touch(form);

    const res = await get(`/api/v1/forms/${form.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        created_at: '2026-01-02T03:04:05.000000Z',
        updated_at: '2026-02-03T04:05:06.000000Z',
        deleted_at: null,
      },
    });
  });

  it.each([
    ['default is oldest first', null, [0, 2, 1]],
    ['ascending', 'created_at', [0, 2, 1]],
    ['descending', '-created_at', [1, 2, 0]],
  ])(
    'sorts the form index by created_at (%s)',
    async (_name, sort, expectedOrder) => {
      const user = await t.factories.user();
      actingAs(user);

      const created: Form[] = [];
      for (const date of ['2026-01-01', '2026-03-01', '2026-02-01']) {
        travelTo(`${date} 00:00:00`);
        created.push(await t.factories.form({ userId: user.id }));
      }

      const res = await get(
        sort === null ? '/api/v1/forms' : `/api/v1/forms?sort=${sort}`,
      );

      expect(res.status).toBe(200);

      expect(body<FormListBody>(res).data.map((f) => f.id)).toEqual(
        expectedOrder.map((index) => created[index].id),
      );
    },
  );

  it('pages the form index by the requested page size', async () => {
    const user = await t.factories.user();
    actingAs(user);
    for (let i = 0; i < 3; i++) await t.factories.form({ userId: user.id });

    const res = await get('/api/v1/forms?per_page=2');

    expect(res.status).toBe(200);
    const list = body<FormListBody>(res);
    expect(list.data).toHaveLength(2);
    expect(list.meta.per_page).toBe(2);
    expect(list.meta.last_page).toBe(2);

    expect(list.links.next).toContain('per_page=2');
  });

  it.each(['0', '101', 'all', '2.5'])(
    'rejects a page size outside 1 to 100 (%s)',
    async (perPage) => {
      actingAs(await t.factories.user());

      const res = await get(`/api/v1/forms?per_page=${perPage}`);

      expectValidationError(res, 'per_page');
    },
  );

  it('keeps the sort in pagination links', async () => {
    const user = await t.factories.user();
    actingAs(user);

    for (let i = 0; i < 16; i++) await t.factories.form({ userId: user.id });

    const res = await get('/api/v1/forms?sort=-created_at');

    expect(res.status).toBe(200);

    expect(body<FormListBody>(res).links.next).toContain('sort=-created_at');
  });

  it.each(['active', 'user_id', 'created_at,-name', '--created_at', 'NAME'])(
    'rejects an unsupported sort (%s)',
    async (sort) => {
      actingAs(await t.factories.user());

      const res = await get(`/api/v1/forms?sort=${encodeURIComponent(sort)}`);

      expectValidationError(res, 'sort');
    },
  );

  it.each([
    ['ascending', 'updated_at', [1, 2, 0]],
    ['descending', '-updated_at', [0, 2, 1]],
  ])(
    'sorts the form index by updated_at (%s)',
    async (_name, sort, expectedOrder) => {
      const user = await t.factories.user();
      actingAs(user);

      travelTo('2026-01-01 00:00:00');
      const created: Form[] = [];
      for (let i = 0; i < 3; i++)
        created.push(await t.factories.form({ userId: user.id }));

      travelTo('2026-03-01 00:00:00');
      await touch(created[0]);
      travelTo('2026-02-01 00:00:00');
      await touch(created[2]);

      const res = await get(`/api/v1/forms?sort=${sort}`);

      expect(res.status).toBe(200);

      expect(body<FormListBody>(res).data.map((f) => f.id)).toEqual(
        expectedOrder.map((index) => created[index].id),
      );
    },
  );

  it.each([
    ['ascending', 'name', ['apple', 'banana', 'Cherry']],
    ['descending', '-name', ['Cherry', 'banana', 'apple']],
  ])(
    'sorts the form index by name case-insensitively (%s)',
    async (_name, sort, expectedNames) => {
      const user = await t.factories.user();
      actingAs(user);

      for (const name of ['banana', 'Cherry', 'apple']) {
        await t.factories.form({ userId: user.id, name });
      }

      const res = await get(`/api/v1/forms?sort=${sort}`);

      expect(res.status).toBe(200);

      expect(body<FormListBody>(res).data.map((f) => f.name)).toEqual(
        expectedNames,
      );
    },
  );

  it.each([
    ['true', 'true', true],
    ['1', '1', true],
    ['false', 'false', false],
    ['0', '0', false],
  ])(
    'filters the form index by active (%s)',
    async (_name, value, expectedActive) => {
      const user = await t.factories.user();
      actingAs(user);

      const active = await t.factories.form({
        ...formStates.active,
        userId: user.id,
      });
      const inactive = await t.factories.form({
        ...formStates.inactive,
        userId: user.id,
      });

      const res = await get(`/api/v1/forms?filter[active]=${value}`);

      expect(res.status).toBe(200);

      expect(body<FormListBody>(res).data.map((f) => f.id)).toEqual([
        (expectedActive ? active : inactive).id,
      ]);
    },
  );

  it('combines the active filter with sorting', async () => {
    const user = await t.factories.user();
    actingAs(user);

    await t.factories.form({
      ...formStates.active,
      userId: user.id,
      name: 'Beta',
    });
    await t.factories.form({
      ...formStates.active,
      userId: user.id,
      name: 'Alpha',
    });
    await t.factories.form({
      ...formStates.inactive,
      userId: user.id,
      name: 'Aardvark',
    });

    const res = await get('/api/v1/forms?sort=name&filter[active]=true');

    expect(res.status).toBe(200);

    expect(body<FormListBody>(res).data.map((f) => f.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('keeps the filter in pagination links', async () => {
    const user = await t.factories.user();
    actingAs(user);

    for (let i = 0; i < 16; i++) {
      await t.factories.form({ ...formStates.active, userId: user.id });
    }

    const res = await get('/api/v1/forms?filter[active]=true');

    expect(res.status).toBe(200);

    expect(
      decodeURIComponent(body<FormListBody>(res).links.next ?? ''),
    ).toContain('filter[active]=true');
  });

  it.each([
    ['unknown filter', 'filter[name]=Contact', 'filter'],
    ['invalid active value', 'filter[active]=yes', 'filter.active'],
  ])('rejects an invalid filter (%s)', async (_name, query, errorKey) => {
    actingAs(await t.factories.user());

    const res = await get(`/api/v1/forms?${query}`);

    expectValidationError(res, errorKey);
  });
});
