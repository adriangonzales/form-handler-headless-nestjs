import { cleanRateLimiterKey, strRandom, strTransliterate } from './str';

describe('strRandom (Str::random)', () => {
  it('returns the requested number of [A-Za-z0-9] characters', () => {
    for (const length of [1, 16, 40, 60, 64]) {
      expect(strRandom(length)).toMatch(new RegExp(`^[A-Za-z0-9]{${length}}$`));
    }
    expect(strRandom()).toHaveLength(16);
    expect(strRandom()).not.toBe(strRandom());
  });
});

describe('strTransliterate (Str::transliterate, approximated)', () => {
  // Expected values from PHP's Str::transliterate().
  it.each([
    ['josé@example.com|1.1.1.1', 'jose@example.com|1.1.1.1'],
    ['Straße@ß.de|::1', 'Strasse@ss.de|::1'],
    ['æøå@x.com|1', 'aeoa@x.com|1'],
    [`a&b<c>"d'e@x.com|1`, `a&b<c>"d'e@x.com|1`],
  ])('%s → %s', (input, expected) => {
    expect(strTransliterate(input)).toBe(expected);
  });

  it('replaces characters it has no mapping for with "?" (voku maps CJK; we do not)', () => {
    expect(strTransliterate('日本@x.com')).toBe('??@x.com');
  });
});

describe('cleanRateLimiterKey', () => {
  it('collapses HTML entities to their first letter, as Laravel does', () => {
    expect(cleanRateLimiterKey(`a&b<c>"d'e`)).toBe('aablcgqd&#039;e');
    expect(cleanRateLimiterKey('owner@example.com|1.1.1.1')).toBe(
      'owner@example.com|1.1.1.1',
    );
  });
});
