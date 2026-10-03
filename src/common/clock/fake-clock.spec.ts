import { SystemClock } from './clock';
import { FakeClock } from './fake-clock';

describe('clocks', () => {
  it('SystemClock returns whole seconds', () => {
    expect(new SystemClock().now().getMilliseconds()).toBe(0);
  });

  it('FakeClock only moves when told, in whole seconds', () => {
    const clock = new FakeClock('2026-01-02T03:04:05.678Z');
    expect(clock.now().toISOString()).toBe('2026-01-02T03:04:05.000Z');
    clock.travel(61_500);
    expect(clock.now().toISOString()).toBe('2026-01-02T03:05:06.000Z');
    clock.now().setFullYear(2000); // callers can't mutate it
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
