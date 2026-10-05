import {
  generateHoneypotName,
  HONEYPOT_PREFIXES,
} from './generate-honeypot-name';

/** `Str::createRandomStringsUsingSequence()`. */
function sequence(...values: string[]): (length: number) => string {
  return () => {
    const next = values.shift();
    if (next === undefined) throw new Error('Random sequence exhausted');
    return next;
  };
}

/** Port of `tests/Feature/Actions/GenerateHoneypotNameTest.php` (2). */
describe('GenerateHoneypotNameTest', () => {
  it('generates a realistic honeypot name with a random suffix', () => {
    const name = generateHoneypotName([], sequence('AbC123'));

    expect(name).toMatch(/^(website|homepage|url|company)_abc123$/);
  });

  it('generates a name that is not already taken', () => {
    const takenNames = HONEYPOT_PREFIXES.map((prefix) => `${prefix}_taken1`);

    const name = generateHoneypotName(takenNames, sequence('taken1', 'free22'));

    expect(name.endsWith('_free22')).toBe(true);
  });
});
