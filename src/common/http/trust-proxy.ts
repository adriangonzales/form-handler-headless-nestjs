import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

/**
 * `TRUSTED_PROXIES`, parsed:
 * - `none`: empty; forwarded headers are ignored.
 * - `calling`: `*`; Laravel trusts only the IP that is calling (one hop).
 * - `list`: IPs and CIDRs.
 */
export type TrustedProxies =
  { kind: 'none' } | { kind: 'calling' } | { kind: 'list'; entries: string[] };

export function parseTrustedProxies(
  raw: string,
): TrustedProxies | { error: string } {
  const value = raw.trim();
  if (value === '') return { kind: 'none' };
  if (value === '*') return { kind: 'calling' };

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const invalid = entries.filter((entry) => !isIpOrCidr(entry));
  if (invalid.length > 0) {
    return { error: `not an IP or CIDR: ${invalid.join(', ')}` };
  }
  return { kind: 'list', entries };
}

/**
 * The Express `trust proxy` value. `*` maps to `1`, not `true`: `true` would
 * trust every hop, so any client could fake `X-Forwarded-For`.
 */
export function trustProxySetting(
  proxies: TrustedProxies,
): boolean | number | string[] {
  switch (proxies.kind) {
    case 'none':
      return false;
    case 'calling':
      return 1;
    case 'list':
      return proxies.entries;
  }
}

/** Express app setting under which `main.ts` stores the parsed proxies. */
export const TRUSTED_PROXIES_SETTING = 'trusted proxies';

/**
 * Port of Symfony's `Request::getClientIps()`. The hop nearest the server
 * comes first and the original client last, which is the reverse of
 * Express's `req.ips`.
 */
export function getClientIps(req: Request): string[] {
  const proxies = trustedProxiesOf(req);
  const remote = stripIpv4Mapped(req.socket.remoteAddress ?? '');
  if (!isFromTrustedProxy(remote, proxies)) return [remote];

  const header = req.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  const clientIps: string[] = [];
  let firstTrustedIp: string | null = null;
  for (const entry of [...forwarded, remote]) {
    const ip = stripIpv4Mapped(stripPort(entry));
    if (isIP(ip) === 0) continue;
    if (isTrusted(ip, remote, proxies)) {
      firstTrustedIp ??= ip;
      continue;
    }
    clientIps.push(ip);
  }

  return clientIps.length > 0
    ? clientIps.reverse()
    : [firstTrustedIp ?? remote];
}

/** Laravel's `$request->ip()`: the first entry of `getClientIps()`. */
export function clientIp(req: Request): string {
  return getClientIps(req)[0];
}

function trustedProxiesOf(req: Request): TrustedProxies {
  const value: unknown = req.app.get(TRUSTED_PROXIES_SETTING);
  return (value as TrustedProxies | undefined) ?? { kind: 'none' };
}

function isFromTrustedProxy(remote: string, proxies: TrustedProxies): boolean {
  return proxies.kind !== 'none' && isTrusted(remote, remote, proxies);
}

function isTrusted(
  ip: string,
  remote: string,
  proxies: TrustedProxies,
): boolean {
  switch (proxies.kind) {
    case 'none':
      return false;
    case 'calling':
      return ip === remote;
    case 'list':
      return proxies.entries.some((entry) => matchesIpOrCidr(ip, entry));
  }
}

/** `1.2.3.4:567` → `1.2.3.4`, `[::1]:567` → `::1`, as Symfony strips ports. */
function stripPort(entry: string): string {
  if (entry.includes('.')) {
    const match = /((?:\d+\.){3}\d+):\d+/.exec(entry);
    return match ? match[1] : entry;
  }
  if (entry.startsWith('[')) {
    const match = /\[([^\]]+)\]:\d+/.exec(entry);
    return match ? match[1] : entry;
  }
  return entry;
}

/** Node reports IPv4 clients on a dual-stack socket as `::ffff:a.b.c.d`. */
function stripIpv4Mapped(ip: string): string {
  return ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4
    ? ip.slice(7)
    : ip;
}

function isIpOrCidr(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function matchesIpOrCidr(ip: string, entry: string): boolean {
  const ipFamily = isIP(ip);
  const [address, prefix] = entry.split('/');
  const family = isIP(address);
  if (ipFamily === 0 || ipFamily !== family) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  const list = new BlockList();
  if (prefix === undefined) list.addAddress(address, type);
  else list.addSubnet(address, Number(prefix), type);
  return list.check(ip, type);
}
