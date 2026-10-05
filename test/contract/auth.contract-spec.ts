import { expectSameJson, normalise, validationBody } from './support/compare';
import { http } from './support/http';
import { loginToken } from './support/session';
import { BASE_URL, describeFeature } from './support/target';

/** Authentication and accounts (ch. 5). */

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ) as Record<string, unknown>;
}

async function login(email: string, password: string) {
  return http('POST', '/api/v1/auth/login', { json: { email, password } });
}

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await login(email, password);
  expect(res.status).toBe(200);
  return (res.body as { access_token: string }).access_token;
}

const PRV = '23bd5c8949f600adb39e701c400872db7a5976f7';

describeFeature('auth', 'POST /auth/login', () => {
  it('returns a bearer token in the login shape', async () => {
    const res = await login(
      process.env.CONTRACT_EMAIL ?? '',
      process.env.CONTRACT_PASSWORD ?? '',
    );
    expect(res.status).toBe(200);
    expectSameJson(normalise(res.body), {
      access_token: '<token>',
      token_type: 'bearer',
      expires_in: 3600,
    });
  });

  it("issues tymon's claims", async () => {
    const claims = claimsOf(await loginToken());
    expect(Object.keys(claims)).toEqual([
      'iss',
      'iat',
      'exp',
      'nbf',
      'jti',
      'sub',
      'prv',
      'tv',
    ]);
    expect(claims).toMatchObject({
      iss: `${BASE_URL}/api/v1/auth/login`,
      sub: '1',
      prv: PRV,
      tv: 0,
    });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
    expect(claims.nbf).toBe(claims.iat);
    expect(claims.jti).toMatch(/^[A-Za-z0-9]{16}$/);
  });

  it('accepts the email in any case', async () => {
    const res = await login(
      (process.env.CONTRACT_EMAIL ?? '').toUpperCase(),
      process.env.CONTRACT_PASSWORD ?? '',
    );
    expect(res.status).toBe(200);
  });

  it('rejects wrong credentials on email', async () => {
    const res = await login(process.env.CONTRACT_EMAIL ?? '', 'wrong');
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        email: ['These credentials do not match our records.'],
      }),
    );
  });

  it('validates the input', async () => {
    const res = await http('POST', '/api/v1/auth/login', {
      json: { email: 'not-an-email', password: ['x'] },
    });
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        email: ['The email field must be a valid email address.'],
        password: ['The password field must be a string.'],
      }),
    );
  });

  it('locks out an email after 5 failures with the seconds left', async () => {
    const email = 'throttled@example.com';
    for (let i = 0; i < 5; i++) {
      expect((await login(email, 'wrong')).status).toBe(422);
    }
    const res = await login(email, 'wrong');
    expect(res.status).toBe(429);
    const body = res.body as { message: string; errors: { email: string[] } };
    expect(body.message).toMatch(
      /^Too many login attempts\. Please try again in \d+ seconds\.$/,
    );
    expectSameJson(body, {
      message: body.message,
      errors: { email: [body.message] },
    });
    expect(res.headers.get('retry-after')).toBeNull();
  });
});

describeFeature('auth', 'GET /auth/me and token sources', () => {
  it('returns the user resource', async () => {
    const res = await http('GET', '/api/v1/auth/me', {
      token: await loginToken(),
    });
    expect(res.status).toBe(200);
    expectSameJson(normalise(res.body), {
      data: {
        id: 1,
        name: 'Contract User',
        email: process.env.CONTRACT_EMAIL,
        email_verified_at: null,
        created_at: '<timestamp>',
        updated_at: '<timestamp>',
      },
    });
  });

  it.each([
    ['no token', {}],
    ['a garbage token', { token: 'not-a-jwt' }],
    ['a wrong scheme', { headers: { Authorization: 'Basic Zm9vOmJhcg==' } }],
  ])('answers 401 to %s', async (_name, options) => {
    const res = await http('GET', '/api/v1/auth/me', options);
    expect(res.status).toBe(401);
    expectSameJson(res.body, { message: 'Unauthenticated.' });
  });

  it('accepts the token from ?token=, a body token, and the last "bearer" in the header', async () => {
    const token = await loginToken();
    expect((await http('GET', `/api/v1/auth/me?token=${token}`)).status).toBe(
      200,
    );
    expect(
      (await http('PATCH', '/api/v1/auth/me', { json: { token } })).status,
    ).toBe(200);
    expect(
      (
        await http('GET', '/api/v1/auth/me', {
          headers: { Authorization: `Basic Zm9v, Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
  });
});

describeFeature('auth', 'POST /auth/refresh and /auth/logout', () => {
  it('rotates the token, keeping iat, sub, prv and tv', async () => {
    const token = await tokenFor(
      process.env.CONTRACT_EMAIL ?? '',
      process.env.CONTRACT_PASSWORD ?? '',
    );
    const res = await http('POST', '/api/v1/auth/refresh', { token });
    expect(res.status).toBe(200);
    expectSameJson(normalise(res.body), {
      access_token: '<token>',
      token_type: 'bearer',
      expires_in: 3600,
    });

    const before = claimsOf(token);
    const after = claimsOf((res.body as { access_token: string }).access_token);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after).toMatchObject({
      iss: `${BASE_URL}/api/v1/auth/refresh`,
      iat: before.iat,
      sub: before.sub,
      prv: before.prv,
      tv: before.tv,
    });
    expect(after.jti).not.toBe(before.jti);

    expect((await http('GET', '/api/v1/auth/me', { token })).status).toBe(401);
    expect((await http('POST', '/api/v1/auth/refresh', { token })).status).toBe(
      401,
    );
  });

  it('answers 401 to a refresh without a token', async () => {
    const res = await http('POST', '/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expectSameJson(res.body, { message: 'Unauthenticated.' });
  });

  it('logs out with 204 and denies the token', async () => {
    const token = await tokenFor(
      process.env.CONTRACT_EMAIL ?? '',
      process.env.CONTRACT_PASSWORD ?? '',
    );
    const res = await http('POST', '/api/v1/auth/logout', { token });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await http('GET', '/api/v1/auth/me', { token })).status).toBe(401);
  });
});

describeFeature('auth', 'account management', () => {
  const email = process.env.CONTRACT_ACCOUNT_EMAIL ?? '';
  let password = process.env.CONTRACT_ACCOUNT_PASSWORD ?? '';
  let token: string;

  beforeAll(async () => {
    token = await tokenFor(email, password);
  });

  it('validates a profile update', async () => {
    const res = await http('PATCH', '/api/v1/auth/me', {
      token,
      json: { name: '', email: 'NOT AN EMAIL' },
    });
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        name: ['The name field is required.'],
        email: ['The email field must be a valid email address.'],
      }),
    );
  });

  it('refuses an email another account uses, compared lowercased', async () => {
    const res = await http('PATCH', '/api/v1/auth/me', {
      token,
      json: { email: (process.env.CONTRACT_EMAIL ?? '').toUpperCase() },
    });
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({ email: ['The email has already been taken.'] }),
    );
  });

  it('updates the name and keeps the email', async () => {
    const res = await http('PATCH', '/api/v1/auth/me', {
      token,
      json: { name: '  Ada Lovelace  ', email: email.toUpperCase() },
    });
    expect(res.status).toBe(200);
    expectSameJson(normalise(res.body), {
      data: {
        id: 2,
        name: 'Ada Lovelace',
        email,
        email_verified_at: null,
        created_at: '<timestamp>',
        updated_at: '<timestamp>',
      },
    });
  });

  it('validates a password change', async () => {
    const res = await http('PUT', '/api/v1/auth/password', {
      token,
      json: {
        current_password: 'wrong',
        password: 'short',
        password_confirmation: 'other',
      },
    });
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        current_password: ['The password is incorrect.'],
        password: [
          'The password field confirmation does not match.',
          'The password field must be at least 8 characters.',
        ],
      }),
    );

    const same = await http('PUT', '/api/v1/auth/password', {
      token,
      json: {
        current_password: password,
        password,
        password_confirmation: password,
      },
    });
    expectSameJson(
      same.body,
      validationBody({
        password: [
          'The password field and current password must be different.',
        ],
      }),
    );
  });

  it('changes the password, revokes the old token and issues one with tv 1', async () => {
    const next = 'account-password-2';
    const res = await http('PUT', '/api/v1/auth/password', {
      token,
      json: {
        current_password: password,
        password: next,
        password_confirmation: next,
      },
    });
    expect(res.status).toBe(200);
    expectSameJson(normalise(res.body), {
      access_token: '<token>',
      token_type: 'bearer',
      expires_in: 3600,
    });
    const fresh = (res.body as { access_token: string }).access_token;
    expect(claimsOf(fresh)).toMatchObject({
      tv: 1,
      iss: `${BASE_URL}/api/v1/auth/password`,
    });
    expect((await http('GET', '/api/v1/auth/me', { token })).status).toBe(401);
    expect(
      (await http('GET', '/api/v1/auth/me', { token: fresh })).status,
    ).toBe(200);
    token = fresh;
    password = next;
  });

  it('refuses to delete the account with a wrong password', async () => {
    const res = await http('DELETE', '/api/v1/auth/me', {
      token,
      json: { password: 'wrong' },
    });
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({ password: ['The password is incorrect.'] }),
    );
  });

  it('deletes the account', async () => {
    const res = await http('DELETE', '/api/v1/auth/me', {
      token,
      json: { password },
    });
    expect(res.status).toBe(204);
    expect((await http('GET', '/api/v1/auth/me', { token })).status).toBe(401);
    expect((await login(email, password)).status).toBe(422);
  });
});

describeFeature('auth', 'password reset', () => {
  // Four requests: under the shared 6/min `password` limit.
  const message =
    'If an account exists for that email, a password reset link has been sent.';

  it('answers the same for a known and an unknown email', async () => {
    for (const email of [process.env.CONTRACT_EMAIL, 'nobody@example.com']) {
      const res = await http('POST', '/api/v1/auth/forgot-password', {
        json: { email },
      });
      expect(res.status).toBe(200);
      expectSameJson(res.body, { message });
    }
  });

  it('validates a reset', async () => {
    const res = await http('POST', '/api/v1/auth/reset-password', {
      json: { email: 'nope' },
    });
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({
        token: ['The token field is required.'],
        email: ['The email field must be a valid email address.'],
        password: ['The password field is required.'],
      }),
    );
  });

  it('rejects an invalid token on email', async () => {
    const res = await http('POST', '/api/v1/auth/reset-password', {
      json: {
        token: 'not-a-real-token',
        email: process.env.CONTRACT_EMAIL,
        password: 'a-brand-new-passphrase',
        password_confirmation: 'a-brand-new-passphrase',
      },
    });
    expect(res.status).toBe(422);
    expectSameJson(
      res.body,
      validationBody({ email: ['This password reset token is invalid.'] }),
    );
  });
});
