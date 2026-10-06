import { eloquentDateTime } from './date';

describe('eloquentDateTime (the datetime cast on write)', () => {
  // Expected values from PHP: $entry->read_at = $value; getAttributes().
  it.each([
    ['2026-01-02T03:04:05Z', '2026-01-02T03:04:05.000Z'],
    ['2026-01-02T03:04:05+02:00', '2026-01-02T03:04:05.000Z'],
    ['2026-01-02', '2026-01-02T00:00:00.000Z'],
    ['1/2/26', '2026-01-02T00:00:00.000Z'],
    ['2026-01-02 03:04:05.789', '2026-01-02T03:04:05.000Z'],
    ['20260102', '1970-08-23T11:48:22.000Z'],
    ['2026-01-02T03:04:05.999999-05:30', '2026-01-02T03:04:05.000Z'],
    ['1767323045', '2026-01-02T03:04:05.000Z'],
  ])('%s → %s', (value, stored) => {
    expect(eloquentDateTime(value)?.toISOString()).toBe(stored);
  });

  it('keeps null', () => {
    expect(eloquentDateTime(null)).toBeNull();
  });
});
