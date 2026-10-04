/**
 * Captures golden HTTP fixtures from the reference Laravel app (ch. 7 §7.4):
 * a fresh SQLite database, a fixed clock, `QUEUE_CONNECTION=sync`, data
 * seeded through the API. Writes test/fixtures/laravel/http/captured.json.
 *
 *   npm run fixtures:capture            # LARAVEL_PATH defaults to ../form-handler-headless-laravel
 *
 * Nothing is written to the Laravel repo: the database, cache and clock live
 * in a temp directory, and logs go to stderr.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startLaravel } from './laravel-server';

const PORT = Number(process.env.CAPTURE_PORT ?? 8765);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(__dirname, 'http', 'captured.json');
const CLOCK_BASE = Date.UTC(2026, 0, 2, 3, 4, 5) / 1000;
const USER = {
  name: 'Contract User',
  email: 'contract@example.com',
  password: 'contract-password',
};
const OTHER = {
  name: 'Other User',
  email: 'other@example.com',
  password: 'other-password',
};

interface Captured {
  name: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

const KEPT_HEADERS = [
  'content-type',
  'allow',
  'retry-after',
  'location',
  'access-control-allow-origin',
];

async function main(): Promise<void> {
  const server = await startLaravel({
    port: PORT,
    users: [USER, OTHER],
    clockBase: CLOCK_BASE,
  });
  try {
    const captured = await capture();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      `${JSON.stringify(normaliseUlids(captured), null, 2)}\n`,
    );
    console.log(`wrote ${OUT} (${captured.length} responses)`);
  } finally {
    server.stop();
  }
}

async function capture(): Promise<Captured[]> {
  const out: Captured[] = [];
  const record = async (
    name: string,
    method: string,
    path: string,
    init: {
      headers?: Record<string, string>;
      body?: unknown;
      raw?: string;
    } = {},
  ) => {
    const res = await send(method, path, init);
    out.push({
      name,
      request: {
        method,
        path,
        // Tokens are never written to fixtures.
        ...(init.headers ? { headers: redact(init.headers) } : {}),
        ...(init.body !== undefined ? { body: init.body } : {}),
      },
      response: res,
    });
    return res;
  };

  const token = await login(USER);
  const otherToken = await login(OTHER);
  const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const form = await send('POST', '/api/v1/forms', {
    headers: auth,
    body: {
      name: 'Contact',
      schema: [
        {
          id: '01K6B6XZ00000000000000000A',
          order: 1,
          label: 'Name',
          rules: ['required'],
        },
        {
          id: '01K6B6XZ00000000000000000B',
          order: 2,
          label: 'Email',
          rules: ['required', 'email'],
        },
        {
          id: '01K6B6XZ00000000000000000C',
          order: 3,
          label: 'Message',
          rules: ['required'],
        },
      ],
    },
  });
  const formId = (form.body as { data: { id: string } }).data.id;
  await send('PUT', `/api/v1/forms/${formId}`, {
    headers: auth,
    body: { name: 'Contact', active: true },
  });

  // Routing and request preparation.
  await record('root redirect', 'GET', '/');
  await record('root post (csrf)', 'POST', '/');
  await record('unknown route', 'GET', '/api/v1/nope', {
    headers: { Accept: 'text/html' },
  });
  await record('wrong method', 'DELETE', '/api/v1/auth/login');
  await record('wrong method on resource', 'POST', `/api/v1/forms/${formId}`, {
    headers: auth,
  });
  await record('body too large', 'POST', '/api/v1/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    raw: JSON.stringify({ email: 'x'.repeat(3 * 1024 * 1024) }),
  });
  await record('cors preflight', 'OPTIONS', '/api/v1/forms/x/submissions', {
    headers: {
      Origin: 'https://customer.example',
      'Access-Control-Request-Method': 'POST',
    },
  });

  // Authentication and authorisation.
  await record('unauthenticated', 'GET', '/api/v1/forms');
  await record('not the owner', 'GET', `/api/v1/forms/${formId}`, {
    headers: {
      Authorization: `Bearer ${otherToken}`,
      Accept: 'application/json',
    },
  });
  await record('invalid ulid', 'GET', '/api/v1/forms/not-a-ulid', {
    headers: auth,
  });
  await record(
    'unknown ulid',
    'GET',
    '/api/v1/forms/01k6b6xz0000000000000000zz',
    { headers: auth },
  );
  await record(
    'uppercase ulid',
    'GET',
    `/api/v1/forms/${formId.toUpperCase()}`,
    { headers: auth },
  );

  // Validation.
  await record('validation (fixed endpoint)', 'POST', '/api/v1/forms', {
    headers: auth,
    body: { schema: [{ id: 'nope', order: 'x' }], settings: { bogus: 1 } },
  });
  await record('malformed json', 'POST', '/api/v1/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    raw: '{"email":',
  });
  await record(
    'submission validation (empty body)',
    'POST',
    `/api/v1/forms/${formId}/submissions`,
    {
      headers: { Accept: 'application/json' },
      body: {},
    },
  );

  // Proxies: the stored ip follows Symfony's order.
  await record(
    'submission through a proxy chain',
    'POST',
    `/api/v1/forms/${formId}/submissions`,
    {
      headers: {
        'X-Forwarded-For': '1.1.1.1, 2.2.2.2',
        Accept: 'application/json',
      },
      body: {
        '01K6B6XZ00000000000000000A': ' Ann ',
        '01K6B6XZ00000000000000000B': 'ann@example.com',
        '01K6B6XZ00000000000000000C': 'Hi',
        extra: 'dropped',
      },
    },
  );
  await record(
    'entries after the proxied submission',
    'GET',
    `/api/v1/forms/${formId}/entries`,
    { headers: auth },
  );

  // Throttling: forgot-password allows 6 per minute per IP.
  for (let i = 0; i < 6; i++) {
    await send('POST', '/api/v1/auth/forgot-password', {
      headers: { Accept: 'application/json' },
      body: { email: 'nobody@example.com' },
    });
  }
  await record('throttled', 'POST', '/api/v1/auth/forgot-password', {
    headers: { Accept: 'application/json' },
    body: { email: 'nobody@example.com' },
  });

  return out;
}

function redact(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k,
      k.toLowerCase() === 'authorization' ? 'Bearer <token>' : v,
    ]),
  );
}

async function login(user: {
  email: string;
  password: string;
}): Promise<string> {
  const res = await send('POST', '/api/v1/auth/login', {
    body: { email: user.email, password: user.password },
  });
  const token = (res.body as { access_token?: string }).access_token;
  if (!token) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return token;
}

async function send(
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: unknown; raw?: string } = {},
): Promise<Captured['response']> {
  const headers: Record<string, string> = { ...init.headers };
  let body: string | undefined = init.raw;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text === '' ? null : '<non-json body>';
  }
  const kept: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) kept[name] = value;
  }
  return { status: res.status, headers: kept, body: parsed };
}

/** Replaces model ULIDs (random per run) with stable placeholders, in order of appearance. */
function normaliseUlids<T>(value: T): T {
  const seen = new Map<string, string>();
  const json = JSON.stringify(value).replace(
    /\b[0-7][0-9a-hjkmnp-tv-z]{25}\b/gi,
    (id) => {
      if (/^01K6B6XZ/i.test(id) || id === '01k6b6xz0000000000000000zz')
        return id; // fixed IDs from the requests
      const key = id.toLowerCase();
      if (!seen.has(key)) seen.set(key, `<ulid:${seen.size + 1}>`);
      const placeholder = seen.get(key) as string;
      return id === key ? placeholder : placeholder.toUpperCase();
    },
  );
  return JSON.parse(json) as T;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
