import request from 'supertest';
import { createApp, type TestApp } from '../support/create-app';
import { probeImports } from '../support/probe.module';

interface InputBody {
  method: string;
  query: Record<string, unknown>;
  source: Record<string, unknown>;
  all: Record<string, unknown>;
}

/** ch. 3 §3.2 _Request input_ and ch. 4 through `@Validated()`. */
describe('request input preparation', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp({ imports: probeImports });
  });

  afterAll(async () => {
    await t.close();
  });

  async function input(req: request.Test): Promise<InputBody> {
    const res = await req.expect(200);
    return res.body as InputBody;
  }

  it('trims strings, turns "" into null, and skips trimming password fields', async () => {
    const body = await input(
      request(t.http)
        .post('/api/v1/probe/input')
        .send({
          name: ' Ann ',
          note: '',
          blank: '   ',
          password: ' secret ',
          password_confirmation: '',
          nested: { a: ' x ' },
        }),
    );
    expect(body.all).toEqual({
      name: 'Ann',
      note: null,
      blank: null,
      password: ' secret ',
      password_confirmation: null,
      nested: { a: 'x' },
    });
  });

  it('merges the query string under the body: body keys win', async () => {
    const body = await input(
      request(t.http)
        .post('/api/v1/probe/input?email=q@example.com&name=Query')
        .send({ name: 'Body' }),
    );
    expect(body.all).toEqual({ name: 'Body', email: 'q@example.com' });
    expect(Object.keys(body.all)).toEqual(['name', 'email']);
  });

  it('rewrites PHP variable names in urlencoded bodies and query strings', async () => {
    const body = await input(
      request(t.http)
        .post('/api/v1/probe/input?a.b=1')
        .type('form')
        .send('first name=Ann&user.email=x&tags[]=a&tags[]=b&pos[1]=x'),
    );
    expect(body.all).toEqual({
      first_name: 'Ann',
      user_email: 'x',
      tags: ['a', 'b'],
      pos: { 1: 'x' },
      a_b: '1',
    });
  });

  it('parses multipart fields the same way and ignores files', async () => {
    const body = await input(
      request(t.http)
        .post('/api/v1/probe/input')
        .field('first name', ' Ann ')
        .field('tags[]', 'a')
        .field('tags[]', 'b')
        .attach('upload', Buffer.from('x'), 'a.txt'),
    );
    expect(body.all).toEqual({ first_name: 'Ann', tags: ['a', 'b'] });
  });

  it('parses urlencoded bodies for PUT, not for GET', async () => {
    const put = await input(
      request(t.http).put('/api/v1/probe/input').type('form').send('a=1'),
    );
    expect(put.all).toEqual({ a: '1' });
    const get = await input(
      request(t.http).get('/api/v1/probe/input?q=1').type('form').send('a=1'),
    );
    expect(get.all).toEqual({ q: '1' });
  });

  it('gives JSON objects the shape json_decode() does', async () => {
    const body = await input(
      request(t.http)
        .post('/api/v1/probe/input')
        .send({ list: { 0: 'a', 1: 'b' }, empty: {} }),
    );
    expect(body.all).toEqual({ list: ['a', 'b'], empty: [] });
  });

  it('honours _method and X-HTTP-Method-Override on POST only', async () => {
    expect(
      (
        await input(
          request(t.http).post('/api/v1/probe/input').send({ _method: 'put' }),
        )
      ).method,
    ).toBe('PUT');
    expect(
      (
        await input(
          request(t.http)
            .post('/api/v1/probe/input')
            .set('X-HTTP-Method-Override', 'PATCH'),
        )
      ).method,
    ).toBe('PATCH');
    expect(
      (await input(request(t.http).post('/api/v1/probe/input?_method=GET')))
        .method,
    ).toBe('POST');
    const bad = await request(t.http)
      .post('/api/v1/probe/input')
      .send({ _method: 'P-UT' })
      .expect(400);
    expect(bad.body).toEqual({ message: 'Bad request.' });
  });
});

describe('@Validated()', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp({ imports: probeImports });
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns validated() output: only ruled keys, from the prepared input', async () => {
    const res = await request(t.http)
      .post('/api/v1/probe/validate?age=5')
      .send({ name: ' Ann ', email: 'a@example.com', extra: 'dropped' })
      .expect(200);
    expect(res.body).toEqual({
      input: { name: 'Ann', email: 'a@example.com', age: '5' },
    });
  });

  it('answers 422 with Laravel’s body, message suffix and key order', async () => {
    const res = await request(t.http)
      .post('/api/v1/probe/validate')
      .send({ name: 'abcdefghijkl', tags: ['ok', 5] })
      .expect(422);
    expect(res.body).toEqual({
      message:
        'The name field must not be greater than 10 characters. (and 2 more errors)',
      errors: {
        name: ['The name field must not be greater than 10 characters.'],
        email: ['The email field is required.'],
        'tags.1': ['The tags.1 field must be a string.'],
      },
    });
    expect(Object.keys((res.body as { errors: object }).errors)).toEqual([
      'name',
      'email',
      'tags.1',
    ]);
  });

  it('treats a whitespace-only value as missing for required', async () => {
    const res = await request(t.http)
      .post('/api/v1/probe/validate')
      .send({ name: '   ', email: 'a@b.c' })
      .expect(422);
    expect(res.body).toEqual({
      message: 'The name field is required.',
      errors: { name: ['The name field is required.'] },
    });
  });

  it('validates a malformed JSON body as {} (422, not 400)', async () => {
    const res = await request(t.http)
      .post('/api/v1/probe/validate')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(422);
    expect(Object.keys((res.body as { errors: object }).errors)).toEqual([
      'name',
      'email',
    ]);
  });

  it('validates urlencoded and multipart string values', async () => {
    await request(t.http)
      .post('/api/v1/probe/validate')
      .type('form')
      .send('name=Ann&email=a@b.c&age=7')
      .expect(200);
    await request(t.http)
      .post('/api/v1/probe/validate')
      .field('name', 'Ann')
      .field('email', 'a@b.c')
      .field('age', 'x')
      .expect(422);
  });

  it('runs prepare() before and after() hooks following the rules', async () => {
    const ok = await request(t.http)
      .put('/api/v1/probe/validate')
      .send({ email: 'A@Example.COM' })
      .expect(200);
    expect(ok.body).toEqual({ input: { email: 'a@example.com' } });
    const res = await request(t.http)
      .put('/api/v1/probe/validate')
      .send({ email: 'TAKEN@example.com' })
      .expect(422);
    expect(res.body).toEqual({
      message: 'The email has already been taken.',
      errors: { email: ['The email has already been taken.'] },
    });
  });
});
