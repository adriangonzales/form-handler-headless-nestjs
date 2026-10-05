import { DenyListService } from '../../../../src/auth/deny-list.service';
import { DeniedToken } from '../../../../src/auth/denied-token.entity';
import { LoginLimiter } from '../../../../src/auth/login-limiter.service';
import type { User } from '../../../../src/users/user.entity';
import { createApp, type TestApp } from '../../../support/create-app';
import {
  json,
  validationErrorKeys,
  body,
  type TokenBody,
  type UserBody,
} from '../../../support/json-request';

/** Port of `tests/Feature/Http/Controllers/AuthControllerTest.php` (16). */
describe('AuthControllerTest', () => {
  let t: TestApp;
  let user: User;

  beforeEach(async () => {
    t = await createApp();
    user = await t.factories.user({
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    });
  });

  afterEach(async () => {
    await t.close();
  });

  const login = (body: object) =>
    json(t.http, 'post', '/api/v1/auth/login', body);

  async function loginToken(): Promise<string> {
    const res = await login({
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    });
    return (res.body as { access_token: string }).access_token;
  }

  const me = (token?: string) =>
    json(t.http, 'get', '/api/v1/auth/me', undefined, token);
  const refresh = (token?: string) =>
    json(t.http, 'post', '/api/v1/auth/refresh', undefined, token);
  const logout = (token: string) =>
    json(t.http, 'post', '/api/v1/auth/logout', undefined, token);
  const deniedTokens = () => t.dataSource.getRepository(DeniedToken);

  it('issues a bearer token for valid credentials', async () => {
    const res = await login({
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: 'bearer', expires_in: 3600 });
    expect(typeof body<TokenBody>(res).access_token).toBe('string');
    expect(body<TokenBody>(res).access_token).not.toBe('');
  });

  it('treats the email as case-insensitive', async () => {
    await login({
      email: 'Owner@Example.com',
      password: 'correct-horse-battery-staple',
    }).expect(200);
  });

  it.each([
    [
      'wrong password',
      { email: 'owner@example.com', password: 'wrong' },
      'email',
    ],
    [
      'unknown email',
      { email: 'nobody@example.com', password: 'correct-horse-battery-staple' },
      'email',
    ],
    ['missing password', { email: 'owner@example.com' }, 'password'],
    ['malformed email', { email: 'not-an-email', password: 'x' }, 'email'],
  ])('rejects invalid credentials (%s)', async (_name, credentials, key) => {
    const res = await login(credentials);

    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toContain(key);
  });

  it('throttles repeated failed logins', async () => {
    for (let i = 0; i < LoginLimiter.MAX_ATTEMPTS; i++) {
      await login({ email: 'owner@example.com', password: 'wrong' }).expect(
        422,
      );
    }

    const res = await login({
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(res.status).toBe(429);
    expect(validationErrorKeys(res.body)).toContain('email');
  });

  it('clears failed attempts after a successful login', async () => {
    for (let i = 0; i < LoginLimiter.MAX_ATTEMPTS - 1; i++) {
      await login({ email: 'owner@example.com', password: 'wrong' });
    }

    await loginToken();

    for (let i = 0; i < LoginLimiter.MAX_ATTEMPTS - 1; i++) {
      await login({ email: 'owner@example.com', password: 'wrong' }).expect(
        422,
      );
    }
  });

  it('returns the authenticated user', async () => {
    const token = await loginToken();

    const res = await me(token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { id: user.id, name: user.name, email: 'owner@example.com' },
    });
    expect(body<UserBody>(res).data).not.toHaveProperty('password');
  });

  // TODO(phase 5a): runs once GET /forms exists.
  it.skip('authenticates API requests with the token', async () => {
    const token = await loginToken();

    await json(t.http, 'get', '/api/v1/forms', undefined, token).expect(200);
  });

  it.each([
    ['no token', undefined],
    ['garbage token', 'not-a-jwt'],
  ])('rejects requests without a valid token (%s)', async (_name, token) => {
    const res = await me(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthenticated.' });
  });

  it('invalidates the token on logout', async () => {
    const token = await loginToken();

    await logout(token).expect(204);

    await me(token).expect(401);
  });

  it('keeps a logged out token invalid after the cache is cleared', async () => {
    const token = await loginToken();

    await logout(token).expect(204);
    t.loginLimiter.flush();

    await me(token).expect(401);
    const [denied] = await deniedTokens().find();
    expect(await deniedTokens().count()).toBe(1);
    expect(denied.expiresAt).toBeInstanceOf(Date);
  });

  it('keeps denied tokens until the refresh window ends, then prunes them', async () => {
    const token = await loginToken();

    await logout(token).expect(204);

    const [denied] = await deniedTokens().find();
    expect(await deniedTokens().count()).toBe(1);
    expect(denied.expiresAt?.getTime()).toBe(
      t.clock.now().getTime() + (10080 + 1) * 60_000,
    );
    const expiresAt = denied.expiresAt as Date;
    const denyList = t.app.get(DenyListService);

    t.clock.set(new Date(expiresAt.getTime() - 1000));
    await denyList.prune();
    expect(await deniedTokens().count()).toBe(1);

    t.clock.set(expiresAt);
    await denyList.prune();
    expect(await deniedTokens().count()).toBe(0);
  });

  it('refreshes a token and invalidates the old one', async () => {
    const token = await loginToken();

    const res = await refresh(token);

    expect(res.status).toBe(200);
    const newToken = (res.body as { access_token: string }).access_token;
    expect(typeof newToken).toBe('string');
    expect(newToken).not.toBe(token);

    await me(token).expect(401);
    await me(newToken).expect(200);
  });

  it('refreshes an expired token within the refresh window', async () => {
    const token = await loginToken();

    t.clock.travel(61 * 60_000);

    await me(token).expect(401);
    await refresh(token).expect(200);
  });

  it('rejects refresh without a token', async () => {
    const res = await refresh();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthenticated.' });
  });

  it('measures the refresh window from the original login', async () => {
    const token = await loginToken();

    t.clock.travel(6 * 86_400_000);
    const refreshed = (
      (await refresh(token).expect(200)).body as { access_token: string }
    ).access_token;

    t.clock.travel(2 * 86_400_000);
    await refresh(refreshed).expect(401);
  });

  it('rejects refresh once the token is older than the 7-day refresh window', async () => {
    t.clock.set('2026-01-01T00:00:00Z');
    const token = await loginToken();

    t.clock.set('2026-01-08T00:00:01Z');
    const res = await refresh(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthenticated.' });
  });
});
