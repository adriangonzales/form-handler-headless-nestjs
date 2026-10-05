import { expectSameJson, normalise, validationBody } from './support/compare';
import { http, type HttpResponse } from './support/http';
import { loginToken, otherUserToken } from './support/session';
import { BASE_URL, byTarget, describeFeature } from './support/target';

/**
 * Forms (ch. 3 §3.3–3.4, ch. 4 §4.5). The suite owns the contract user's
 * forms: `beforeAll` deletes any left over, so list cases see only theirs.
 */

const FIELD_A = '01K6E2E0000000000000000001';
const FIELD_B = '01K6E2E0000000000000000002';
const SETTINGS_DEFAULTS = {
  redirect: null,
  timezone: null,
  domains: [],
  message: null,
  honeypot_enabled: false,
  honeypot_name: null,
};

interface FormData {
  id: string;
  name: string;
  settings: Record<string, unknown> | null;
}

let token: string;
let otherToken: string;

function api(
  method: string,
  path: string,
  json?: unknown,
  as: string = token,
): Promise<HttpResponse> {
  return http(method, `/api/v1${path}`, {
    json: method === 'GET' ? undefined : json,
    token: as,
    headers: { Accept: 'application/json' },
  });
}

function data(res: HttpResponse): FormData {
  return (res.body as { data: FormData }).data;
}

async function createForm(body: object, as: string = token): Promise<FormData> {
  const res = await api('POST', '/forms', body, as);
  expect(res.status).toBe(201);
  return data(res);
}

/** A form resource as both servers return it, IDs and timestamps normalised. */
function formResource(fields: {
  name: string;
  active?: boolean;
  schema?: unknown;
  settings?: unknown;
  counts?: [number, number, number];
}): Record<string, unknown> {
  return {
    id: '<ulid:1>',
    user_id: 1,
    name: fields.name,
    active: fields.active ?? false,
    schema: fields.schema ?? null,
    settings: fields.settings ?? null,
    ...(fields.counts && {
      entries_count: fields.counts[0],
      unread_entries_count: fields.counts[1],
      spam_entries_count: fields.counts[2],
    }),
    created_at: '<timestamp>',
    updated_at: '<timestamp>',
    deleted_at: null,
  };
}

beforeAll(async () => {
  token = await loginToken();
  otherToken = await otherUserToken();
  for (;;) {
    const res = await api('GET', '/forms?per_page=100');
    const forms = (res.body as { data?: FormData[] }).data ?? [];
    if (forms.length === 0) break;
    for (const form of forms) await api('DELETE', `/forms/${form.id}`);
  }
});

describeFeature('forms', 'POST /forms', () => {
  it('creates an inactive form, sorting the schema and filling settings', async () => {
    const res = await api('POST', '/forms', {
      name: '  Contact  ',
      active: true,
      user_id: 99,
      schema: [
        { id: FIELD_B, order: 2, label: 'Email', rules: ['required', 'email'] },
        { id: FIELD_A, order: 1, name: 'name', rules: 'required', label: '' },
      ],
      settings: { message: 'Thanks!', domains: ['Example.com'] },
    });

    expect(res.status).toBe(201);
    expectSameJson(normalise(res.body, [FIELD_A, FIELD_B]), {
      data: formResource({
        name: 'Contact',
        schema: [
          {
            id: FIELD_A,
            order: 1,
            name: 'name',
            rules: 'required',
            label: null,
          },
          {
            id: FIELD_B,
            order: 2,
            label: 'Email',
            rules: ['required', 'email'],
          },
        ],
        settings: {
          ...SETTINGS_DEFAULTS,
          domains: ['Example.com'],
          message: 'Thanks!',
        },
      }),
    });
  });

  it('stores {} settings as every default and keeps schema [] as []', async () => {
    const res = await api('POST', '/forms', {
      name: 'Defaults',
      schema: [],
      settings: {},
    });

    expect(res.status).toBe(201);
    expectSameJson(normalise(res.body), {
      data: formResource({
        name: 'Defaults',
        schema: [],
        settings: SETTINGS_DEFAULTS,
      }),
    });
  });

  it('keeps urlencoded values as strings and coerces honeypot_enabled', async () => {
    const res = await http('POST', '/api/v1/forms', {
      token,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      raw: `name=Urlencoded&schema[0][id]=${FIELD_A}&schema[0][order]=1&schema[0][rules][]=required&settings[honeypot_enabled]=1&settings[honeypot_name]=trap`,
    });

    expect(res.status).toBe(201);
    expectSameJson(normalise(res.body, [FIELD_A]), {
      data: formResource({
        name: 'Urlencoded',
        schema: [{ id: FIELD_A, order: '1', rules: ['required'] }],
        settings: {
          ...SETTINGS_DEFAULTS,
          honeypot_enabled: true,
          honeypot_name: 'trap',
        },
      }),
    });
  });

  it('generates a honeypot name when enabled without one', async () => {
    const form = await createForm({
      name: 'Honeypot',
      settings: { honeypot_enabled: true },
    });

    expect(form.settings?.honeypot_name).toMatch(
      /^(website|homepage|url|company)_[a-z0-9]{6}$/,
    );
  });

  it('reports structural errors in Laravel order', async () => {
    const res = await api('POST', '/forms', {
      name: 'x'.repeat(401),
      schema: [
        { id: FIELD_A, order: 1, type: 'text' },
        {
          id: FIELD_A,
          order: 1.5,
          label: ['x'],
          name: 5,
          rules: [['required']],
        },
        'field',
      ],
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        // A scalar item is expanded first (array_merge keeps its dotted
        // key's place), and its wildcard children are initialised to null.
        name: ['The name field must not be greater than 400 characters.'],
        'schema.2': ['The schema.2 field must be an array.'],
        'schema.0': ['The schema.0 field must be an array.'],
        'schema.0.id': ['The schema.0.id field has a duplicate value.'],
        'schema.1.id': ['The schema.1.id field has a duplicate value.'],
        'schema.2.id': ['The schema.2.id field is required.'],
        'schema.1.order': ['The schema.1.order field must be an integer.'],
        'schema.2.order': ['The schema.2.order field is required.'],
        'schema.1.label': ['The schema.1.label field must be a string.'],
        'schema.1.name': ['The schema.1.name field must be a string.'],
        'schema.1.rules.0': ['The schema.1.rules.0 field must be a string.'],
      }),
    );
  });

  it('rejects a schema that is a JSON string', async () => {
    const res = await api('POST', '/forms', { name: 'x', schema: '[]' });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({ schema: ['The schema field must be a list.'] }),
    );
  });

  it('rejects a schema keyed by field ID, still checking its items', async () => {
    const res = await api('POST', '/forms', {
      name: 'x',
      schema: { [FIELD_A]: { order: 1 } },
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        schema: ['The schema field must be a list.'],
        [`schema.${FIELD_A}.id`]: [
          `The schema.${FIELD_A}.id field is required.`,
        ],
      }),
    );
  });

  it('reports every settings error', async () => {
    const res = await api('POST', '/forms', {
      name: 'x',
      settings: {
        redirect: 'not a url',
        timezone: 'Mars/Olympus_Mons',
        domains: ['https://example.com/path', 123, '*.example.org'],
        message: 'a'.repeat(2001),
        honeypot_enabled: 'yes please',
        honeypot_name: 'contact.website',
      },
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        'settings.redirect': [
          'The settings.redirect field must be a valid URL.',
        ],
        'settings.timezone': [
          'The settings.timezone field must be a valid timezone.',
        ],
        'settings.message': [
          'The settings.message field must not be greater than 2000 characters.',
        ],
        'settings.honeypot_enabled': [
          'The settings.honeypot enabled field must be true or false.',
        ],
        'settings.honeypot_name': [
          'The settings.honeypot name field format is invalid.',
        ],
        'settings.domains.0': [
          'The settings.domains.0 field format is invalid.',
        ],
        // 123 passes the regex: PHP matches numbers as strings.
        'settings.domains.1': [
          'The settings.domains.1 field must be a string.',
        ],
      }),
    );
  });

  it('rejects unknown settings keys and non-list domains', async () => {
    const res = await api('POST', '/forms', {
      name: 'x',
      settings: { captcha: 'recaptcha', domains: { primary: 'example.com' } },
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        settings: ['The settings field must be an array.'],
        'settings.domains': ['The settings.domains field must be a list.'],
      }),
    );
  });

  it('rejects a honeypot name that matches a schema input name', async () => {
    const res = await api('POST', '/forms', {
      name: 'x',
      schema: [{ id: FIELD_A, order: 1, name: 'website' }],
      settings: { honeypot_enabled: true, honeypot_name: 'website' },
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        'settings.honeypot_name': [
          'The honeypot name must not match a schema field.',
        ],
      }),
    );
  });

  it('F7: checks rule names on save', async () => {
    const res = await api('POST', '/forms', {
      name: 'F7',
      schema: [{ id: FIELD_A, order: 1, rules: ['requird'] }],
    });

    expect(res.status).toBe(byTarget({ laravel: 201, nest: 422 }));
    if (res.status === 422) {
      expectSameJson(
        res.body,
        validationBody({
          'schema.0.rules': [
            'The schema.0.rules field contains an unsupported rule: requird.',
          ],
        }),
      );
    }
  });
});

describeFeature('forms', 'GET/PUT/PATCH/DELETE /forms/:form', () => {
  let form: FormData;

  beforeAll(async () => {
    form = await createForm({
      name: 'Editable',
      schema: [{ id: FIELD_A, order: 1, name: 'website' }],
      settings: { honeypot_enabled: true, honeypot_name: 'trap' },
    });
  });

  it('shows the form', async () => {
    const res = await api('GET', `/forms/${form.id}`);

    expect(res.status).toBe(200);
    expectSameJson(normalise(res.body, [FIELD_A]), {
      data: formResource({
        name: 'Editable',
        schema: [{ id: FIELD_A, order: 1, name: 'website' }],
        settings: {
          ...SETTINGS_DEFAULTS,
          honeypot_enabled: true,
          honeypot_name: 'trap',
        },
      }),
    });
  });

  it('requires name and active on PATCH', async () => {
    const res = await api('PATCH', `/forms/${form.id}`, { name: 'Renamed' });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({ active: ['The active field is required.'] }),
    );
  });

  it('rejects "true" for active', async () => {
    const res = await api('PUT', `/forms/${form.id}`, {
      name: 'x',
      active: 'true',
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({ active: ['The active field must be true or false.'] }),
    );
  });

  it('checks a new schema against the stored honeypot name', async () => {
    const res = await api('PUT', `/forms/${form.id}`, {
      name: 'Editable',
      active: true,
      schema: [{ id: FIELD_A, order: 1, name: 'trap' }],
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        schema: [
          'The schema must not contain a field named after the honeypot.',
        ],
      }),
    );
  });

  it('updates with PUT and PATCH, keeping omitted schema and settings', async () => {
    const put = await api('PUT', `/forms/${form.id}`, {
      name: 'Renamed',
      active: '1',
    });
    expect(put.status).toBe(200);

    const patch = await api('PATCH', `/forms/${form.id}`, {
      name: 'Renamed again',
      active: 1,
      settings: { honeypot_enabled: true, message: 'Hi' },
    });

    expect(patch.status).toBe(200);
    expectSameJson(normalise(patch.body, [FIELD_A]), {
      data: formResource({
        name: 'Renamed again',
        active: true,
        schema: [{ id: FIELD_A, order: 1, name: 'website' }],
        settings: {
          ...SETTINGS_DEFAULTS,
          message: 'Hi',
          honeypot_enabled: true,
          honeypot_name: 'trap',
        },
      }),
    });
  });

  it('clears schema and settings with null', async () => {
    const res = await api('PUT', `/forms/${form.id}`, {
      name: 'Cleared',
      active: false,
      schema: null,
      settings: null,
    });

    expect(res.status).toBe(200);
    expectSameJson(normalise(res.body), {
      data: formResource({ name: 'Cleared' }),
    });
  });

  it('answers POST on a form with 405 and Allow', async () => {
    const res = await api('POST', `/forms/${form.id}`);

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD, PUT, PATCH, DELETE');
  });

  it('soft-deletes, then 404s everywhere but restore, which is idempotent', async () => {
    const deleted = await createForm({ name: 'Doomed' });

    const del = await api('DELETE', `/forms/${deleted.id}`);
    expect(del.status).toBe(204);
    expect(del.text).toBe('');

    for (const [method, path] of [
      ['GET', `/forms/${deleted.id}`],
      ['PUT', `/forms/${deleted.id}`],
      ['DELETE', `/forms/${deleted.id}`],
      ['POST', `/forms/${deleted.id}/duplicate`],
    ]) {
      const res = await api(method, path, {});
      expect(res.status).toBe(404);
      expectSameJson(res.body, {
        message: `No query results for model [App\\Models\\Form] ${deleted.id}`,
      });
    }

    for (let i = 0; i < 2; i++) {
      const res = await api('POST', `/forms/${deleted.id}/restore`);
      expect(res.status).toBe(200);
      expectSameJson(normalise(res.body), {
        data: formResource({ name: 'Doomed' }),
      });
    }
  });

  it('duplicates as an inactive copy within 400 characters', async () => {
    const long = await createForm({
      name: `${'a'.repeat(390)}  bbbbbbbb`,
      settings: { message: 'Hi' },
    });

    const res = await api('POST', `/forms/${long.id}/duplicate`);

    expect(res.status).toBe(201);
    expectSameJson(normalise(res.body), {
      data: formResource({
        name: `${'a'.repeat(390)}  b (copy)`,
        settings: { ...SETTINGS_DEFAULTS, message: 'Hi' },
      }),
    });
  });
});

describeFeature('forms', 'ownership and bindings', () => {
  let theirs: FormData;

  beforeAll(async () => {
    theirs = await createForm({ name: 'Not yours' }, otherToken);
  });

  it.each([
    ['GET', ''],
    ['PUT', ''],
    ['PATCH', ''],
    ['DELETE', ''],
    ['POST', '/restore'],
    ['POST', '/duplicate'],
  ])('gives a non-owner 403 on %s /forms/:form%s', async (method, suffix) => {
    const res = await api(method, `/forms/${theirs.id}${suffix}`, {
      name: ['invalid'],
    });

    expect(res.status).toBe(403);
    expectSameJson(res.body, { message: 'You do not own this form.' });
  });

  it('gives 404 for unknown, invalid and uppercase IDs', async () => {
    const mine = await createForm({ name: 'Case' });
    for (const id of [
      '01k6b6xz0000000000000000zz',
      'not-a-ulid',
      mine.id.toUpperCase(),
    ]) {
      const res = await api('PUT', `/forms/${id}`, {});
      expect(res.status).toBe(404);
      expectSameJson(res.body, {
        message: `No query results for model [App\\Models\\Form] ${id}`,
      });
    }
  });
});

describeFeature('forms', 'GET /forms', () => {
  beforeAll(async () => {
    // Start from a clean list: only these forms are live.
    for (;;) {
      const res = await api('GET', '/forms?per_page=100');
      const forms = (res.body as { data: FormData[] }).data;
      if (forms.length === 0) break;
      for (const form of forms) await api('DELETE', `/forms/${form.id}`);
    }
    for (const name of ['banana', 'Cherry', 'apple', '_under', 'date']) {
      await createForm({ name });
    }
    const cherry = await api('GET', '/forms?sort=name');
    const id = (cherry.body as { data: FormData[] }).data.find(
      (f) => f.name === 'Cherry',
    )?.id;
    await api('PUT', `/forms/${id}`, { name: 'Cherry', active: true });
  });

  it('pages, sorts and filters with Laravel links and meta', async () => {
    const query = 'sort=-name&per_page=2&filter%5Bactive%5D=false&page=2';
    const res = await api('GET', `/forms?${query}`);

    expect(res.status).toBe(200);
    const url = (page: number) =>
      `${BASE_URL}/api/v1/forms?sort=-name&per_page=2&filter%5Bactive%5D=false&page=${page}`;
    expectSameJson(normalise(res.body), {
      data: [
        { ...formResource({ name: 'apple', counts: [0, 0, 0] }) },
        {
          ...formResource({ name: '_under', counts: [0, 0, 0] }),
          id: '<ulid:2>',
        },
      ],
      links: { first: url(1), last: url(2), prev: url(1), next: null },
      meta: {
        current_page: 2,
        from: 3,
        last_page: 2,
        links: [
          {
            url: url(1),
            label: '&laquo; Previous',
            page: 1,
            active: false,
          },
          { url: url(1), label: '1', page: 1, active: false },
          { url: url(2), label: '2', page: 2, active: true },
          { url: null, label: 'Next &raquo;', page: null, active: false },
        ],
        path: `${BASE_URL}/api/v1/forms`,
        per_page: 2,
        to: 4,
        total: 4,
      },
    });
  });

  it('sorts names by lower(name), ties by id', async () => {
    const res = await api('GET', '/forms?sort=name');

    expect((res.body as { data: FormData[] }).data.map((f) => f.name)).toEqual([
      '_under',
      'apple',
      'banana',
      'Cherry',
      'date',
    ]);
  });

  it.each(['abc', '0', '-2', '2.5'])(
    'treats ?page=%s as page 1',
    async (page) => {
      const res = await api('GET', `/forms?page=${page}&per_page=1`);

      expect(res.status).toBe(200);
      expect(
        (res.body as { meta: { current_page: number } }).meta.current_page,
      ).toBe(1);
    },
  );

  it('rejects bad list parameters', async () => {
    const res = await api(
      'GET',
      '/forms?per_page=101&sort=NAME&filter%5Bname%5D=x&filter%5Bactive%5D=yes',
    );

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        per_page: ['The per page field must be between 1 and 100.'],
        sort: ['The selected sort is invalid.'],
        filter: ['The filter field must be an array.'],
        'filter.active': ['The selected filter.active is invalid.'],
      }),
    );
  });

  it('rejects an empty sort and a scalar filter', async () => {
    const res = await api('GET', '/forms?sort=&filter=x&per_page=all');

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        per_page: ['The per page field must be an integer.'],
        sort: [
          'The sort field must be a string.',
          'The selected sort is invalid.',
        ],
        filter: ['The filter field must be an array.'],
      }),
    );
  });
});
