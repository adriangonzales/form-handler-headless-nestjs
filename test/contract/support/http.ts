import { BASE_URL } from './target';

export interface HttpResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON, or the raw text when the body isn't JSON. */
  body: unknown;
  text: string;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as-is (set Content-Type yourself). */
  raw?: string;
  token?: string;
}

export async function http(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<HttpResponse> {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined = options.raw;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers['Content-Type'] ??= 'application/json';
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (process.env.CONTRACT_DEBUG) console.log(`${method} ${BASE_URL}${path}`);
  const res = await fetch(`${BASE_URL}${path}`, {
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
    // not JSON
  }
  return { status: res.status, headers: res.headers, body: parsed, text };
}
