import type { Request } from 'express';
import { extractToken, parseAuthorizationHeader } from './token-extractor';

describe("parseAuthorizationHeader (tymon's AuthHeaders)", () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['BEARER   abc  ', 'abc'],
    ['Bearer abc, Basic xyz', 'abc'],
    // The last "bearer" wins.
    ['Bearer one Bearer two', 'two'],
    ['Basic Zm9vOmJhcg==, Bearer abc', 'abc'],
    ['Bearer', ''],
  ])('%j → %j', (header, expected) => {
    expect(parseAuthorizationHeader(header)).toBe(expected);
  });

  it('returns null without a header or a "bearer"', () => {
    expect(parseAuthorizationHeader(undefined)).toBeNull();
    expect(parseAuthorizationHeader('')).toBeNull();
    expect(parseAuthorizationHeader('Basic Zm9vOmJhcg==')).toBeNull();
  });
});

describe('extractToken (header, then ?token=, then input token)', () => {
  const req = (options: {
    authorization?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    method?: string;
  }) =>
    ({
      method: options.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.authorization
          ? { authorization: options.authorization }
          : {}),
      },
      query: options.query ?? {},
      body: options.body ?? {},
    }) as unknown as Request;

  it('prefers the header, then the query string, then the body', () => {
    expect(
      extractToken(
        req({
          authorization: 'Bearer h',
          query: { token: 'q' },
          body: { token: 'b' },
        }),
      ),
    ).toBe('h');
    expect(
      extractToken(req({ query: { token: 'q' }, body: { token: 'b' } })),
    ).toBe('q');
    expect(extractToken(req({ body: { token: 'b' } }))).toBe('b');
  });

  it('skips empty and "0" values, as PHP truthiness does', () => {
    expect(
      extractToken(req({ authorization: 'Bearer ', body: { token: 'b' } })),
    ).toBe('b');
    expect(
      extractToken(req({ query: { token: '0' }, body: { token: 'b' } })),
    ).toBe('b');
    expect(extractToken(req({ body: { token: '' } }))).toBeNull();
  });

  it('ignores non-string token fields', () => {
    expect(extractToken(req({ body: { token: ['a'] } }))).toBeNull();
  });
});
