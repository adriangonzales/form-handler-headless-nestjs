import { phpRound, spamScoreTransformer } from './spam-score.transformer';

describe('phpRound', () => {
  // php -r 'foreach ([...] as $v) echo round($v, 2);' on PHP 8.4
  it.each([
    [0.456, 0.46],
    [0.285, 0.29],
    [1.005, 1.01],
    [0.455, 0.46],
    [0.125, 0.13],
    [2.675, 2.68],
    [0.015, 0.02],
    [9.995, 10],
    [1.4999999999, 1.5],
    [-0.005, -0.01],
    [0, 0],
    [1e-7, 0],
  ])('round(%p, 2) === %p, as in PHP', (value, expected) => {
    expect(phpRound(value, 2)).toBe(expected);
  });
});

describe('spamScoreTransformer', () => {
  it('rounds to 2 decimals on write', () => {
    expect(spamScoreTransformer.to(0.456)).toBe(0.46);
    expect(spamScoreTransformer.to('0.285')).toBe(0.29);
  });

  it('reads Postgres numeric strings back as numbers', () => {
    expect(spamScoreTransformer.from('0.46')).toBe(0.46);
    expect(spamScoreTransformer.from(null)).toBeNull();
  });
});
