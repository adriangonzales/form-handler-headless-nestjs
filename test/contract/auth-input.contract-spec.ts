import { expectSameJson } from './support/compare';
import { http } from './support/http';
import { describeFeature } from './support/target';

/** Input preparation and validation bodies through the login endpoint (ch. 3 §3.2, ch. 5). */
describeFeature('auth', 'request input through POST /auth/login', () => {
  it('validates a malformed JSON body as {} (422, not 400)', async () => {
    const res = await http('POST', '/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      raw: '{"email":',
    });
    expect(res.status).toBe(422);
    expectSameJson(res.body, {
      message: 'The email field is required. (and 1 more error)',
      errors: {
        email: ['The email field is required.'],
        password: ['The password field is required.'],
      },
    });
  });

  it('trims input and turns "" into null before validating', async () => {
    const res = await http('POST', '/api/v1/auth/login', {
      json: { email: '   ', password: '' },
    });
    expect(res.status).toBe(422);
    expect(Object.keys((res.body as { errors: object }).errors)).toEqual([
      'email',
      'password',
    ]);
  });

  it('merges the query string into the input', async () => {
    const res = await http('POST', '/api/v1/auth/login?email=not-an-email', {
      json: { password: 'x' },
    });
    expect(res.status).toBe(422);
    expectSameJson(res.body, {
      message: 'The email field must be a valid email address.',
      errors: { email: ['The email field must be a valid email address.'] },
    });
  });
});
