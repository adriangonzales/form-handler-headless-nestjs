import request from 'supertest';
import type { App } from 'supertest/types';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Pest's `getJson()` / `postJson()` / ... and `withToken()`: JSON requests
 * with `Accept: application/json` and, when given, a bearer token.
 */
export function json(
  http: App,
  method: Method,
  url: string,
  body?: object,
  token?: string,
): request.Test {
  let req = request(http)[method](url).set('Accept', 'application/json');
  if (token !== undefined) req = req.set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

/** `expect($response)->assertJsonValidationErrors($key)`. */
export function validationErrorKeys(body: unknown): string[] {
  return Object.keys((body as { errors?: object }).errors ?? {});
}

export interface TokenBody {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserBody {
  data: {
    id: number;
    name: string;
    email: string;
    email_verified_at: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
}

export interface ErrorBody {
  message: string;
  errors: Record<string, string[]>;
}

/** A Supertest response body, typed. */
export function body<T>(res: { body: unknown }): T {
  return res.body as T;
}
