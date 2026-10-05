/**
 * REDIS_URL with another database number. Jest runs e2e files in parallel,
 * and each suite that FLUSHDBs needs a database of its own: 15 rate limits,
 * 13 password reset, 12 the login limiter (14 is the contract run's).
 */
export function testRedisUrl(db: number): string {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/15');
  url.pathname = `/${db}`;
  return url.toString();
}
