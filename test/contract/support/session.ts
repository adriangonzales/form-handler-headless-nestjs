import { http } from './http';

/**
 * Logs in with the seeded contract user (`user:create` on both servers) once
 * per suite; the token is never written anywhere.
 */
const tokens = new Map<string, Promise<string>>();

export function loginToken(): Promise<string> {
  return loginAs('CONTRACT_EMAIL', 'CONTRACT_PASSWORD');
}

/** The second seeded user, owner of the forms the 403 cases use. */
export function otherUserToken(): Promise<string> {
  return loginAs('CONTRACT_OTHER_EMAIL', 'CONTRACT_OTHER_PASSWORD');
}

function loginAs(emailVar: string, passwordVar: string): Promise<string> {
  let token = tokens.get(emailVar);
  token ??= (async () => {
    const email = process.env[emailVar];
    const password = process.env[passwordVar];
    if (!email || !password)
      throw new Error(`Set ${emailVar} and ${passwordVar}`);
    const res = await http('POST', '/api/v1/auth/login', {
      json: { email, password },
    });
    const value = (res.body as { access_token?: string }).access_token;
    if (res.status !== 200 || !value)
      throw new Error(`login failed: ${res.status} ${res.text}`);
    return value;
  })();
  tokens.set(emailVar, token);
  return token;
}
