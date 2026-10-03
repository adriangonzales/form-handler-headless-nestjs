import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHttpApp } from './support/create-http-app';

interface ProbeGetBody {
  query: unknown;
  ips: string[];
  expressIp: string;
}

describe('HTTP app setup (ch. 1)', () => {
  let app: NestExpressApplication;
  let server: App;

  beforeAll(async () => {
    app = await createHttpApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('root routes', () => {
    it('GET /up returns 200', async () => {
      await request(server).get('/up').expect(200);
    });

    it.each(['get', 'head', 'options'] as const)(
      '%s / redirects to the docs',
      async (method) => {
        const res = await request(server)[method]('/').expect(302);
        expect(res.headers.location).toMatch(
          /^http:\/\/127\.0\.0\.1:\d+\/docs\/api$/,
        );
      },
    );

    it.each(['post', 'put', 'patch', 'delete'] as const)(
      '%s / fails the web CSRF check with 419, as Laravel does',
      async (method) => {
        const res = await request(server)[method]('/').expect(419);
        expect(res.body).toEqual({ message: 'CSRF token mismatch.' });
      },
    );
  });

  describe('JSON errors', () => {
    it('unknown routes are 404 JSON, without Accept: application/json', async () => {
      const res = await request(server)
        .get('/nope/deeper/')
        .set('Accept', 'text/html')
        .expect(404)
        .expect('Content-Type', /application\/json/);
      expect(res.body).toEqual({
        message: 'The route nope/deeper could not be found.',
      });
    });

    it('the wrong method on a known route is 405 with Allow', async () => {
      const res = await request(server).delete('/up').expect(405);
      expect(res.headers.allow).toBe('GET, HEAD');
      expect(res.body).toEqual({
        message:
          'The DELETE method is not supported for route up. Supported methods: GET, HEAD.',
      });
    });

    it('lists every other method of the matching routes, in Laravel order', async () => {
      const res = await request(server).put('/api/v1/probe').expect(405);
      expect(res.headers.allow).toBe('GET, HEAD, POST');
    });

    it('a body over BODY_LIMIT is 413 JSON', async () => {
      const res = await request(server)
        .post('/api/v1/probe')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ big: 'x'.repeat(2 * 1024 * 1024) }))
        .expect(413);
      expect(res.body).toEqual({ message: 'The POST data is too large.' });
    });
  });

  describe('body parsing', () => {
    it('malformed JSON becomes {} instead of a 400', async () => {
      const res = await request(server)
        .post('/api/v1/probe')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(201);
      expect(res.body).toEqual({ body: {} });
    });

    it('parses urlencoded bodies with nested keys', async () => {
      const res = await request(server)
        .post('/api/v1/probe')
        .type('form')
        .send('name=Ann&tags[]=a&tags[]=b')
        .expect(201);
      expect(res.body).toEqual({ body: { name: 'Ann', tags: ['a', 'b'] } });
    });

    it('parses multipart text fields and ignores file parts', async () => {
      const res = await request(server)
        .post('/api/v1/probe')
        .field('name', 'Ann')
        .attach('upload', Buffer.from('file contents'), 'a.txt')
        .expect(201);
      expect(res.body).toEqual({ body: { name: 'Ann' } });
    });

    it('a request without a body gets {}', async () => {
      const res = await request(server).post('/api/v1/probe').expect(201);
      expect(res.body).toEqual({ body: {} });
    });
  });

  it('uses the extended query parser (Express 5 defaults to simple)', async () => {
    const res = await request(server)
      .get('/api/v1/probe?filter[read]=1')
      .expect(200);
    expect((res.body as ProbeGetBody).query).toEqual({
      filter: { read: '1' },
    });
  });

  describe('CORS on /api only', () => {
    it('answers preflight with 204 and echoes the requested method', async () => {
      const res = await request(server)
        .options('/api/v1/forms/x/submissions')
        .set('Origin', 'https://customer.example')
        .set('Access-Control-Request-Method', 'post')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toBe('POST');
      expect(res.headers['access-control-max-age']).toBe('0');
    });

    it('adds CORS headers to error responses', async () => {
      const res = await request(server)
        .get('/api/v1/nope')
        .set('Origin', 'https://customer.example')
        .expect(404);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('leaves routes outside /api alone', async () => {
      const res = await request(server)
        .get('/up')
        .set('Origin', 'https://customer.example')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('API docs', () => {
    it('serves the UI at /docs/api', async () => {
      await request(server)
        .get('/docs/api')
        .expect(200)
        .expect('Content-Type', /html/);
    });

    it('serves the OpenAPI document at /docs/api.json', async () => {
      const res = await request(server).get('/docs/api.json').expect(200);
      expect((res.body as { openapi: string }).openapi).toMatch(/^3\./);
    });
  });
});

describe('trusted proxies (ch. 1 §1.4)', () => {
  it.each([
    ['', ['127.0.0.1'], '127.0.0.1'],
    ['*', ['2.2.2.2', '1.1.1.1'], '2.2.2.2'],
    ['127.0.0.1', ['2.2.2.2', '1.1.1.1'], '2.2.2.2'],
  ])(
    'TRUSTED_PROXIES=%j with X-Forwarded-For: 1.1.1.1, 2.2.2.2',
    async (trusted, ips, ip) => {
      const app = await createHttpApp({ TRUSTED_PROXIES: trusted });
      try {
        const res = await request(app.getHttpServer() as App)
          .get('/api/v1/probe')
          .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2')
          .expect(200);
        const body = res.body as ProbeGetBody;
        expect(body.ips).toEqual(ips);
        expect(body.ips[0]).toBe(ip);
        // Express's own req.ip agrees for these chains.
        expect(body.expressIp.replace(/^::ffff:/, '')).toBe(ip);
      } finally {
        await app.close();
      }
    },
  );
});
