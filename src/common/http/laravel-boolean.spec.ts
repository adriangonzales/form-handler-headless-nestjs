import {
  isLaravelBoolean,
  parseFilterBoolean,
  toLaravelBoolean,
} from './laravel-boolean';

describe('Laravel boolean helpers', () => {
  it.each([true, false, 0, 1, '0', '1'])('%j is a Laravel boolean', (value) => {
    expect(isLaravelBoolean(value)).toBe(true);
  });

  it.each(['true', 'false', 'yes', 2, null, '', 1.5])('%j is not', (value) => {
    expect(isLaravelBoolean(value)).toBe(false);
  });

  it('converts validated values and filters', () => {
    expect(
      [true, 1, '1', false, 0, '0'].map((v) => toLaravelBoolean(v as never)),
    ).toEqual([true, true, true, false, false, false]);
    expect(
      ['true', '1', 'false', '0'].map((v) => parseFilterBoolean(v as never)),
    ).toEqual([true, true, false, false]);
  });
});
