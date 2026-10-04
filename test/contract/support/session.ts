import { http } from './http';

/**
 * Logs in with the seeded contract user (`user:create` on both servers) once
 * per suite; the token is never written anywhere.
 */
let token: Promise<string> | undefined;

export function loginToken(): Promise<string> {
  token ??= (async () => {
    const email = process.env.CONTRACT_EMAIL;
    const password = process.env.CONTRACT_PASSWORD;
    if (!email || !password)
      throw new Error('Set CONTRACT_EMAIL and CONTRACT_PASSWORD');
    const res = await http('POST', '/api/v1/auth/login', {
      json: { email, password },
    });
    const value = (res.body as { access_token?: string }).access_token;
    if (res.status !== 200 || !value)
      throw new Error(`login failed: ${res.status} ${res.text}`);
    return value;
  })();
  return token;
}
