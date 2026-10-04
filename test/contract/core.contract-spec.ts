import { expectSameJson } from './support/compare';
import { http } from './support/http';
import { describeFeature } from './support/target';

/**
 * Cross-cutting behaviour that needs no endpoint from later phases
 * (ch. 1 §1.4, ch. 3 §3.1–3.2). Expectations come from Laravel's responses
 * (test/fixtures/laravel/http/captured.json).
 */
describeFeature('core', 'root and health routes', () => {
  it('GET /up returns 200', async () => {
    expect((await http('GET', '/up')).status).toBe(200);
  });

  it('GET / redirects to the docs on the request host', async () => {
    const res = await http('GET', '/');
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe(
      '/docs/api',
    );
  });

  it('POST / fails the web CSRF check with 419', async () => {
    const res = await http('POST', '/');
    expect(res.status).toBe(419);
    expectSameJson(res.body, { message: 'CSRF token mismatch.' });
  });
});

describeFeature('core', 'JSON errors for routing and request size', () => {
  it('unknown routes are JSON 404s, even for text/html clients', async () => {
    const res = await http('GET', '/api/v1/nope', {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expectSameJson(res.body, {
      message: 'The route api/v1/nope could not be found.',
    });
  });

  it('a wrong method on a known path is 405 with Allow', async () => {
    const res = await http('DELETE', '/up');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expectSameJson(res.body, {
      message:
        'The DELETE method is not supported for route up. Supported methods: GET, HEAD.',
    });
  });

  it('a body over 2 MB is 413 before routing', async () => {
    const res = await http('POST', '/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      raw: JSON.stringify({ email: 'x'.repeat(3 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    expectSameJson(res.body, { message: 'The POST data is too large.' });
  });
});

describeFeature('core', 'CORS on /api', () => {
  it('answers preflight with 204, any origin, the requested method and max-age 0', async () => {
    const res = await http('OPTIONS', '/api/v1/forms/x/submissions', {
      headers: {
        Origin: 'https://customer.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('POST');
    expect(res.headers.get('access-control-max-age')).toBe('0');
  });

  it('adds CORS headers to error responses', async () => {
    const res = await http('GET', '/api/v1/nope', {
      headers: { Origin: 'https://customer.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describeFeature('core', 'API docs', () => {
  it('serves the OpenAPI document at /docs/api.json', async () => {
    const res = await http('GET', '/docs/api.json');
    expect(res.status).toBe(200);
    expect((res.body as { openapi?: string }).openapi).toMatch(/^3\./);
  });
});
