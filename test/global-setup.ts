/**
 * Runs once in Jest's parent process, before workers start. `TZ` has to be
 * set here: `setupFiles` run inside the test sandbox, whose `process.env` is
 * a copy, so setting `TZ` there doesn't change the process's timezone. The
 * pg driver reads `timestamp without time zone` in that timezone (ch. 2 §2.1).
 */
export default function globalSetup(): void {
  process.env.TZ = 'UTC';
}
