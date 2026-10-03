import type { Request } from 'express';
import {
  getClientIps,
  parseTrustedProxies,
  TRUSTED_PROXIES_SETTING,
  TrustedProxies,
  trustProxySetting,
} from './trust-proxy';

function request(
  proxies: TrustedProxies,
  remoteAddress: string,
  forwardedFor?: string,
): Request {
  return {
    app: {
      get: (name: string) =>
        name === TRUSTED_PROXIES_SETTING ? proxies : undefined,
    },
    socket: { remoteAddress },
    headers:
      forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  } as unknown as Request;
}

const list = (...entries: string[]): TrustedProxies => ({
  kind: 'list',
  entries,
});

describe('parseTrustedProxies / trustProxySetting', () => {
  it.each([
    ['', false],
    ['  ', false],
    ['*', 1],
    ['127.0.0.1, 10.0.0.0/8 ,::1', ['127.0.0.1', '10.0.0.0/8', '::1']],
  ])('%j → %j', (raw, expected) => {
    const parsed = parseTrustedProxies(raw);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(trustProxySetting(parsed)).toEqual(expected);
  });

  it.each(['10.0.0.0/33', 'localhost', '1.2.3.4/8/1'])('rejects %j', (raw) => {
    expect(parseTrustedProxies(raw)).toHaveProperty('error');
  });
});

describe('getClientIps (Symfony order)', () => {
  it('ignores forwarded headers when no proxy is trusted', () => {
    expect(
      getClientIps(request({ kind: 'none' }, '::ffff:127.0.0.1', '1.1.1.1')),
    ).toEqual(['127.0.0.1']);
  });

  it('with *, trusts only the calling IP and reverses the chain', () => {
    expect(
      getClientIps(
        request({ kind: 'calling' }, '::ffff:10.0.0.5', '1.1.1.1, 2.2.2.2'),
      ),
    ).toEqual(['2.2.2.2', '1.1.1.1']);
  });

  it('ignores forwarded headers from an untrusted socket', () => {
    expect(
      getClientIps(request(list('10.0.0.0/8'), '192.168.1.1', '1.1.1.1')),
    ).toEqual(['192.168.1.1']);
  });

  it('removes trusted hops, strips ports and drops invalid entries', () => {
    expect(
      getClientIps(
        request(
          list('10.0.0.0/8'),
          '10.0.0.1',
          'garbage, 1.1.1.1:5000, [2001:db8::1]:443, 10.2.3.4',
        ),
      ),
    ).toEqual(['2001:db8::1', '1.1.1.1']);
  });

  it('falls back to the first trusted address when every hop is trusted', () => {
    expect(
      getClientIps(request(list('10.0.0.0/8'), '10.0.0.1', '10.9.9.9')),
    ).toEqual(['10.9.9.9']);
  });
});
