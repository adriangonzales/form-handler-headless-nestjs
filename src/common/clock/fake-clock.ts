import { Clock, wholeSeconds } from './clock';

/**
 * A clock that only moves when told to. Tests bind it in place of `Clock`
 * and call `travel()`, Pest's `$this->travel()` (ch. 7 §7.1). Don't use
 * Jest's fake timers instead: they stall better-sqlite3, BullMQ and Supertest.
 */
export class FakeClock extends Clock {
  private current: Date;

  constructor(start: Date | string = '2026-01-01T00:00:00Z') {
    super();
    this.current = wholeSeconds(new Date(start));
  }

  now(): Date {
    return new Date(this.current);
  }

  travel(ms: number): this {
    this.current = wholeSeconds(new Date(this.current.getTime() + ms));
    return this;
  }

  set(date: Date | string): this {
    this.current = wholeSeconds(new Date(date));
    return this;
  }
}
