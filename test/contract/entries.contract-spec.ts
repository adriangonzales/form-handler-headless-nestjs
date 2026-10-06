import { expectSameJson, normalise, validationBody } from './support/compare';
import { http, type HttpResponse } from './support/http';
import { loginToken, otherUserToken } from './support/session';
import { BASE_URL, byTarget, describeFeature } from './support/target';

/**
 * Entries and public submissions (ch. 3 §3.5–3.6). Every request carries
 * its own client IP (both servers trust 127.0.0.1), so the submission and
 * password-reset rate limits of one case never leak into another.
 */

const NAME = '01K6B6XZ00000000000000000A';
const EMAIL = '01K6B6XZ00000000000000000B';
const MESSAGE = '01K6B6XZ00000000000000000C';
const BASIC_SCHEMA = [
  { id: NAME, order: 1, label: 'Name', rules: ['required'] },
  { id: EMAIL, order: 2, label: 'Email', rules: ['required', 'email'] },
  { id: MESSAGE, order: 3, label: 'Message', rules: ['required'] },
];
const KEEP = [NAME, EMAIL, MESSAGE];

interface Entry {
  id: string;
  [key: string]: unknown;
}

let token: string;
let otherToken: string;
let nextIp = 1;

/** A fresh TEST-NET-2 address for one case's requests. */
function clientIp(): string {
  const n = nextIp++;
  return `198.51.${100 + Math.floor(n / 250)}.${(n % 250) + 1}`;
}

function api(
  method: string,
  path: string,
  options: {
    json?: unknown;
    as?: string | null;
    ip?: string;
    headers?: Record<string, string>;
    raw?: string;
  } = {},
): Promise<HttpResponse> {
  const as = options.as === undefined ? token : options.as;
  return http(method, `/api/v1${path}`, {
    json: method === 'GET' ? undefined : options.json,
    raw: options.raw,
    token: as ?? undefined,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'contract-suite',
      'X-Forwarded-For': options.ip ?? clientIp(),
      ...options.headers,
    },
  });
}

async function createForm(
  body: Record<string, unknown>,
  active = true,
  as: string = token,
): Promise<string> {
  const res = await api('POST', '/forms', { json: body, as });
  expect(res.status).toBe(201);
  const id = (res.body as { data: { id: string } }).data.id;
  if (active) {
    const update = await api('PUT', `/forms/${id}`, {
      json: { name: body.name, active: true },
      as,
    });
    expect(update.status).toBe(200);
  }
  return id;
}

async function listEntries(formId: string, query = ''): Promise<Entry[]> {
  const res = await api('GET', `/forms/${formId}/entries${query}`);
  expect(res.status).toBe(200);
  return (res.body as { data: Entry[] }).data;
}

/**
 * Laravel parses the user agent of public submissions in a listener; the
 * port adds that in phase 6, so it's left out of submission comparisons.
 */
function withoutUserAgentDisplay(entry: Entry): Entry {
  const copy = { ...entry };
  delete copy.user_agent_display;
  return copy;
}

/** An entry resource, as both servers return it, normalised. */
function entryResource(fields: Partial<Record<string, unknown>>): Entry {
  return {
    id: '<ulid:1>',
    form_id: '<ulid:2>',
    input: [],
    ip: '<ip>',
    ip_location_display: null,
    referer: null,
    user_agent: 'contract-suite',
    user_agent_display: null,
    spam: false,
    spam_score: 0,
    spam_reason: null,
    spam_checked_at: '<timestamp>',
    starred: false,
    read_at: null,
    created_at: '<timestamp>',
    updated_at: '<timestamp>',
    deleted_at: null,
    ...fields,
  };
}

function normaliseEntry(entry: unknown): Entry {
  const out = normalise(entry, KEEP) as Entry;
  if (typeof out.ip === 'string') out.ip = '<ip>';
  return out;
}

beforeAll(async () => {
  token = await loginToken();
  otherToken = await otherUserToken();
});

describeFeature('entries', 'POST /forms/:form/entries (owner)', () => {
  let formId: string;

  beforeAll(async () => {
    formId = await createForm({ name: 'Owner entries', schema: BASIC_SCHEMA });
  });

  it('stores validated fields only, with the request metadata', async () => {
    const ip = clientIp();
    const res = await api('POST', `/forms/${formId}/entries`, {
      ip,
      headers: { Referer: 'https://example.com/contact' },
      json: {
        [NAME]: ' Ada ',
        [EMAIL]: 'ada@example.com',
        [MESSAGE]: 'Hi',
        x: 1,
      },
    });

    expect(res.status).toBe(201);
    const data = (res.body as { data: Entry }).data;
    expect(data.ip).toBe(ip);
    expectSameJson(normaliseEntry(data), {
      ...entryResource({
        input: { [NAME]: 'Ada', [EMAIL]: 'ada@example.com', [MESSAGE]: 'Hi' },
        referer: 'https://example.com/contact',
      }),
    });
  });

  it('reports every missing field', async () => {
    const res = await api('POST', `/forms/${formId}/entries`, { json: {} });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        [NAME]: ['The 01 k6 b6 x z00000000000000000 a field is required.'],
        [EMAIL]: ['The 01 k6 b6 x z00000000000000000 b field is required.'],
        [MESSAGE]: ['The 01 k6 b6 x z00000000000000000 c field is required.'],
      }),
    );
  });

  it('checks ownership, then that the form is active', async () => {
    const inactive = await createForm({ name: 'Inactive' }, false);

    const notOwner = await api('POST', `/forms/${formId}/entries`, {
      as: otherToken,
      json: {},
    });
    expect(notOwner.status).toBe(403);
    expectSameJson(notOwner.body, { message: 'You do not own this form.' });

    const res = await api('POST', `/forms/${inactive}/entries`, { json: {} });
    expect(res.status).toBe(403);
    expectSameJson(res.body, {
      message: 'This form is not accepting submissions.',
    });
  });
});

describeFeature('entries', 'GET /forms/:form/entries', () => {
  let formId: string;

  beforeAll(async () => {
    formId = await createForm({
      name: 'Listed entries',
      schema: [{ id: NAME, order: 1, name: 'n' }],
    });
    for (const n of ['one', 'two', 'three']) {
      await api('POST', `/forms/${formId}/entries`, { json: { n } });
    }
    const [first] = await listEntries(formId);
    await api('PATCH', `/entries/${first.id}`, {
      json: { starred: true, spam_score: 0.9 },
    });
  });

  it('pages and filters with Laravel links and meta', async () => {
    const query =
      '?sort=-created_at&filter%5Bstarred%5D=false&per_page=1&page=2';
    const res = await api('GET', `/forms/${formId}/entries${query}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: Entry[]; links: unknown; meta: unknown };
    expect(body.data.map((e) => (e.input as { n: string }).n)).toEqual(['two']);
    const url = (page: number) =>
      `${BASE_URL}/api/v1/forms/${formId}/entries?sort=-created_at&filter%5Bstarred%5D=false&per_page=1&page=${page}`;
    expectSameJson(body.links, {
      first: url(1),
      last: url(2),
      prev: url(1),
      next: null,
    });
    expectSameJson(body.meta, {
      current_page: 2,
      from: 2,
      last_page: 2,
      links: [
        { url: url(1), label: '&laquo; Previous', page: 1, active: false },
        { url: url(1), label: '1', page: 1, active: false },
        { url: url(2), label: '2', page: 2, active: true },
        { url: null, label: 'Next &raquo;', page: null, active: false },
      ],
      path: `${BASE_URL}/api/v1/forms/${formId}/entries`,
      per_page: 1,
      to: 2,
      total: 2,
    });
  });

  it('sorts by spam_score with ties in creation order', async () => {
    const entries = await listEntries(formId, '?sort=-spam_score');

    expect(entries.map((e) => (e.input as { n: string }).n)).toEqual([
      'one',
      'three',
      'two',
    ]);
  });

  it('rejects bad filters with Laravel messages', async () => {
    const res = await api(
      'GET',
      `/forms/${formId}/entries?filter%5Bcreated_from%5D=2026-02-02&filter%5Bcreated_to%5D=2026-02-01&filter%5Btrashed%5D=all&filter%5Bread%5D=yes&sort=ip`,
    );

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        sort: ['The selected sort is invalid.'],
        'filter.read': ['The selected filter.read is invalid.'],
        'filter.created_to': [
          'The filter.created to field must be a date after or equal to filter.created from.',
        ],
        'filter.trashed': ['The selected filter.trashed is invalid.'],
      }),
    );
  });

  it('rejects a timestamp for a date filter and unknown filter keys', async () => {
    const res = await api(
      'GET',
      `/forms/${formId}/entries?filter%5Bcreated_from%5D=2026-02-01T00:00:00&filter%5Bip%5D=x`,
    );

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        filter: ['The filter field must be an array.'],
        'filter.created_from': [
          'The filter.created from field must match the format Y-m-d.',
        ],
      }),
    );
  });
});

describeFeature('entries', 'GET/PUT/PATCH/DELETE /entries/:entry', () => {
  let formId: string;

  const newEntry = async (): Promise<Entry> => {
    const res = await api('POST', `/forms/${formId}/entries`, {
      json: { n: 'x' },
    });
    return (res.body as { data: Entry }).data;
  };

  beforeAll(async () => {
    formId = await createForm({
      name: 'Triage',
      schema: [{ id: NAME, order: 1, name: 'n' }],
    });
  });

  it('updates only the fields sent, rounding and casting', async () => {
    const entry = await newEntry();

    const res = await api('PATCH', `/entries/${entry.id}`, {
      json: {
        spam: '1',
        spam_score: '0.285',
        spam_reason: ' Manual ',
        read_at: '2026-01-02T03:04:05+02:00',
      },
    });

    expect(res.status).toBe(200);
    const data = (res.body as { data: Entry }).data;
    // The offset is ignored: Eloquent stores the wall-clock time.
    expect(data.read_at).toBe('2026-01-02T03:04:05.000000Z');
    expectSameJson(normaliseEntry(data), {
      ...entryResource({
        input: { n: 'x' },
        spam: true,
        spam_score: 0.29,
        spam_reason: 'Manual',
        read_at: '<timestamp>',
      }),
    });
  });

  it('stores a numeric read_at as Unix seconds', async () => {
    const entry = await newEntry();

    const res = await api('PATCH', `/entries/${entry.id}`, {
      json: { read_at: '20260102' },
    });

    expect(res.status).toBe(200);
    expect((res.body as { data: Entry }).data.read_at).toBe(
      '1970-08-23T11:48:22.000000Z',
    );
  });

  it('rejects read-only fields, nulls and bad triage values', async () => {
    const entry = await newEntry();

    const res = await api('PUT', `/entries/${entry.id}`, {
      json: {
        input: null,
        user_agent_display: null,
        spam_checked_at: '2026-01-01',
        spam: 'true',
        spam_score: 10,
        starred: null,
        read_at: 'yesterday-ish',
      },
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        input: ['The input field must be missing.'],
        user_agent_display: ['The user agent display field must be missing.'],
        spam_checked_at: ['The spam checked at field must be missing.'],
        spam: ['The spam field must be true or false.'],
        spam_score: ['The spam score field must be between 0 and 9.99.'],
        starred: ['The starred field is required.'],
        read_at: ['The read at field must be a valid date.'],
      }),
    );
  });

  it('deletes, hides, restores, and only force-deletes deleted entries', async () => {
    const entry = await newEntry();

    const conflict = await api('DELETE', `/entries/${entry.id}/force`);
    expect(conflict.status).toBe(409);
    expectSameJson(conflict.body, {
      message: 'Only deleted entries can be permanently deleted.',
    });

    expect((await api('DELETE', `/entries/${entry.id}`)).status).toBe(204);

    const hidden = await api('GET', `/entries/${entry.id}`);
    expect(hidden.status).toBe(404);
    expectSameJson(hidden.body, {
      message: `No query results for model [App\\Models\\FormEntry] ${entry.id}`,
    });

    const trashed = await listEntries(formId, '?filter%5Btrashed%5D=only');
    expect(trashed.map((e) => e.id)).toEqual([entry.id]);
    expect(trashed[0].deleted_at).toMatch(/\.000000Z$/);

    const restored = await api('POST', `/entries/${entry.id}/restore`);
    expect(restored.status).toBe(200);
    expect((restored.body as { data: Entry }).data.deleted_at).toBeNull();

    await api('DELETE', `/entries/${entry.id}`);
    expect((await api('DELETE', `/entries/${entry.id}/force`)).status).toBe(
      204,
    );
    expect((await api('POST', `/entries/${entry.id}/restore`)).status).toBe(
      404,
    );
  });

  it('gives 403 for entries of another user and of a deleted form', async () => {
    const entry = await newEntry();
    const theirs = await api('GET', `/entries/${entry.id}`, { as: otherToken });
    expect(theirs.status).toBe(403);

    const doomed = await createForm({ name: 'Doomed' });
    const child = (
      (await api('POST', `/forms/${doomed}/entries`, { json: {} })).body as {
        data: Entry;
      }
    ).data;
    await api('DELETE', `/forms/${doomed}`);

    const res = await api('GET', `/entries/${child.id}`);
    expect(res.status).toBe(403);
    expectSameJson(res.body, { message: 'You do not own this form.' });
  });
});

describeFeature('entries', 'POST /forms/:form/entries/bulk', () => {
  let formId: string;
  let ids: string[];

  beforeAll(async () => {
    formId = await createForm({ name: 'Bulk' });
    ids = [];
    for (let i = 0; i < 3; i++) {
      const res = await api('POST', `/forms/${formId}/entries`, { json: {} });
      ids.push((res.body as { data: Entry }).data.id);
    }
  });

  it('counts only changed rows', async () => {
    const first = await api('POST', `/forms/${formId}/entries/bulk`, {
      json: { action: 'star', ids: ids.slice(0, 2) },
    });
    expectSameJson(first.body, { data: { action: 'star', affected: 2 } });

    const again = await api('POST', `/forms/${formId}/entries/bulk`, {
      json: { action: 'star', ids },
    });
    expectSameJson(again.body, { data: { action: 'star', affected: 1 } });
  });

  it('deletes, restores and force-deletes', async () => {
    for (const [action, affected] of [
      ['delete', 3],
      ['restore', 3],
      ['delete', 3],
      ['force_delete', 3],
    ] as const) {
      const res = await api('POST', `/forms/${formId}/entries/bulk`, {
        json: { action, ids },
      });
      expect(res.status).toBe(200);
      expectSameJson(res.body, { data: { action, affected } });
    }
  });

  it('reports invalid input', async () => {
    const res = await api('POST', `/forms/${formId}/entries/bulk`, {
      json: { action: 'archive', ids: ['a', 'a', 5] },
    });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        action: ['The selected action is invalid.'],
        'ids.0': ['The ids.0 field has a duplicate value.'],
        'ids.1': ['The ids.1 field has a duplicate value.'],
        'ids.2': ['The ids.2 field must be a string.'],
      }),
    );
  });

  it('rejects an empty or oversized list', async () => {
    const none = await api('POST', `/forms/${formId}/entries/bulk`, {
      json: { action: 'star', ids: [] },
    });
    expectSameJson(
      none.body,
      validationBody({ ids: ['The ids field is required.'] }),
    );

    const many = await api('POST', `/forms/${formId}/entries/bulk`, {
      json: {
        action: 'star',
        ids: Array.from({ length: 101 }, (_, i) => `id-${i}`),
      },
    });
    expect(many.status).toBe(422);
    expect(Object.keys((many.body as { errors: object }).errors)[0]).toBe(
      'ids',
    );
    expect((many.body as { errors: { ids: string[] } }).errors.ids).toEqual([
      'The ids field must not have more than 100 items.',
    ]);
  });
});

describeFeature('submissions', 'POST /forms/:form/submissions', () => {
  let formId: string;

  beforeAll(async () => {
    formId = await createForm({
      name: 'Public',
      schema: BASIC_SCHEMA,
      settings: {
        redirect: 'https://example.com/thanks',
        message: 'Thanks!',
        domains: ['example.com', '*.example.org'],
        honeypot_enabled: true,
        honeypot_name: 'website',
      },
    });
  });

  const submit = (
    data: Record<string, unknown>,
    headers: Record<string, string> = {},
    query = '',
    id = formId,
  ) =>
    api('POST', `/forms/${id}/submissions${query}`, {
      as: null,
      json: data,
      headers: { Referer: 'https://example.com/contact', ...headers },
    });

  const valid = { [NAME]: 'Ada', [EMAIL]: 'ada@example.com', [MESSAGE]: 'Hi' };

  it('responds with the redirect and message, and stores the entry', async () => {
    const res = await submit({ ...valid, [NAME]: ' Ada ', extra: 'x' });

    expect(res.status).toBe(201);
    expectSameJson(res.body, {
      data: { redirect: 'https://example.com/thanks', message: 'Thanks!' },
    });

    const [latest] = await listEntries(formId, '?sort=-created_at&per_page=1');
    expectSameJson(withoutUserAgentDisplay(normaliseEntry(latest)), {
      ...withoutUserAgentDisplay(
        entryResource({
          input: valid,
          referer: 'https://example.com/contact',
          spam_checked_at: null,
        }),
      ),
    });
  });

  it.each([
    ['a value', 'https://spam.example', true],
    ['zero', 0, true],
    ['false', false, true],
    ['an empty list', [], false],
    ['an empty object', {}, false],
    ['whitespace', '   ', false],
  ])(
    'treats a honeypot of %s as filled: %p',
    async (_name, website, tripped) => {
      const res = await submit({ ...valid, website });
      expect(res.status).toBe(201);

      const [latest] = await listEntries(
        formId,
        '?sort=-created_at&per_page=1',
      );
      expect(latest.spam).toBe(tripped);
      expect(latest.spam_reason).toBe(
        tripped ? 'Honeypot field was filled in.' : null,
      );
      expect(latest.spam_checked_at === null).toBe(!tripped);
      expect(latest.input).not.toHaveProperty('website');
    },
  );

  it('checks the honeypot in the query string too', async () => {
    await submit(valid, {}, '?website=x');

    const [latest] = await listEntries(formId, '?sort=-created_at&per_page=1');
    expect(latest.spam).toBe(true);
  });

  it.each([
    ['https://EXAMPLE.com/contact', true],
    ['https://a.b.example.org/', true],
    ['https://example.org/', false],
    ['https://www.example.com/', false],
    ['//example.com/x', true],
    ['https://user@example.com:8443/x', true],
    ['https://evil.net\\@example.com/', true],
    ['https://example.com:99999/', false],
    ['example.com', false],
  ])('checks the Referer %s against the domains: %p', async (referer, ok) => {
    const res = await submit(valid, { Referer: referer });

    expect(res.status).toBe(ok ? 201 : 403);
    if (!ok) {
      expectSameJson(res.body, {
        message: 'Submissions are not accepted from this domain.',
      });
    }
  });

  it('reports the schema errors', async () => {
    const res = await submit({ [EMAIL]: 'not an email' });

    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        [NAME]: ['The 01 k6 b6 x z00000000000000000 a field is required.'],
        [EMAIL]: [
          'The 01 k6 b6 x z00000000000000000 b field must be a valid email address.',
        ],
        [MESSAGE]: ['The 01 k6 b6 x z00000000000000000 c field is required.'],
      }),
    );
  });

  it('accepts urlencoded and multipart bodies, with PHP key rewriting', async () => {
    const plain = await createForm({
      name: 'Plain',
      schema: [
        { id: NAME, order: 1, name: 'first_name', rules: ['required'] },
        { id: EMAIL, order: 2, name: 'agree', rules: ['boolean'] },
        { id: MESSAGE, order: 3, name: 'email', rules: ['email'] },
      ],
    });

    const urlencoded = await api(
      'POST',
      `/forms/${plain}/submissions?email=q@example.com`,
      {
        as: null,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        raw: 'first+name=+Ann+&agree=1&ignored=x',
      },
    );
    expect(urlencoded.status).toBe(201);

    const boundary = 'contractboundary';
    const multipart = await api('POST', `/forms/${plain}/submissions`, {
      as: null,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      raw: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="first name"',
        '',
        'Bea',
        `--${boundary}`,
        'Content-Disposition: form-data; name="upload"; filename="a.txt"',
        'Content-Type: text/plain',
        '',
        'file body',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    });
    expect(multipart.status).toBe(201);

    const inputs = (await listEntries(plain)).map((e) => e.input);
    expectSameJson(inputs, [
      { first_name: 'Ann', agree: '1', email: 'q@example.com' },
      { first_name: 'Bea' },
    ]);
  });

  it('gives 404 for unknown and deleted forms, and 403 for inactive ones', async () => {
    const res = await submit(valid, {}, '', '01k6b6xz0000000000000000zz');
    expect(res.status).toBe(404);
    expectSameJson(res.body, {
      message:
        'No query results for model [App\\Models\\Form] 01k6b6xz0000000000000000zz',
    });

    const inactive = await createForm({ name: 'Closed' }, false);
    const closed = await submit(valid, {}, '', inactive);
    expect(closed.status).toBe(403);
    expectSameJson(closed.body, {
      message: 'This form is not accepting submissions.',
    });

    await api('DELETE', `/forms/${inactive}`);
    expect((await submit(valid, {}, '', inactive)).status).toBe(404);
  });
});

describeFeature('submissions', 'submission rate limits', () => {
  let formId: string;

  beforeAll(async () => {
    formId = await createForm({ name: 'Throttled' });
  });

  const submitFrom = (ip: string, id = formId) =>
    api('POST', `/forms/${id}/submissions`, { as: null, ip, json: {} });

  it('allows 60 per form per client, then 429 with Retry-After', async () => {
    const ip = clientIp();
    for (let i = 0; i < 60; i++) {
      expect((await submitFrom(ip)).status).toBe(201);
    }

    const res = await submitFrom(ip);
    expect(res.status).toBe(429);
    expectSameJson(res.body, { message: 'Too Many Attempts.' });
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    expect((await submitFrom(clientIp())).status).toBe(201);
  });

  it('counts unknown form IDs, so 429 comes before 404', async () => {
    const ip = clientIp();
    const unknown = '01k6b6xz0000000000000000zz';
    for (let i = 0; i < 60; i++) {
      expect((await submitFrom(ip, unknown)).status).toBe(404);
    }
    expect((await submitFrom(ip, unknown)).status).toBe(429);
  });

  it('F9: submissions and password reset have separate counters', async () => {
    const ip = clientIp();
    for (let i = 0; i < 6; i++) {
      expect((await submitFrom(ip)).status).toBe(201);
    }

    const res = await api('POST', '/auth/forgot-password', {
      as: null,
      ip,
      json: { email: 'nobody@example.com' },
    });

    expect(res.status).toBe(byTarget({ laravel: 429, nest: 200 }));
  });
});
