import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanInput, strTrim } from './request-input';

const corpus = JSON.parse(
  readFileSync(
    join(__dirname, '../../../test/fixtures/validation/corpus.json'),
    'utf8',
  ),
) as { trim: [string, string][] };

describe('strTrim vs Str::trim()', () => {
  it.each(corpus.trim)('%j → %j', (input, php) => {
    expect(strTrim(input)).toBe(php);
  });
});

describe('cleanInput (TrimStrings + ConvertEmptyStringsToNull)', () => {
  it('trims nested strings and turns "" into null', () => {
    expect(
      cleanInput({
        name: ' Ann ',
        empty: '',
        blank: '  ',
        nested: { tags: [' a ', ''] },
        n: 5,
      }),
    ).toEqual({
      name: 'Ann',
      empty: null,
      blank: null,
      nested: { tags: ['a', null] },
      n: 5,
    });
  });

  it('never trims top-level password fields, but still nulls ""', () => {
    expect(
      cleanInput({
        password: ' secret ',
        password_confirmation: '',
        current_password: '  ',
        user: { password: ' x ' },
      }),
    ).toEqual({
      password: ' secret ',
      password_confirmation: null,
      current_password: '  ',
      user: { password: 'x' },
    });
  });
});
