/**
 * The only source of "now" (ch. 2 §2.1). Times are whole seconds, as Eloquent
 * stores them, so API timestamps always end in `.000000Z`.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return wholeSeconds(new Date());
  }
}

/** Truncates to whole seconds (Eloquent truncates; Postgres `timestamp(0)` would round). */
export function wholeSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}
