import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRelativeSignature, signRelativeUrl } from './signed-url';

interface Fixture {
  key: string;
  now: number;
  export: string;
  minutes: number;
  relative: string;
}

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, '../../../test/fixtures/laravel/golden/signed-urls.json'),
    'utf8',
  ),
) as Fixture[];

describe('signed export URLs vs Laravel', () => {
  it.each(fixtures.map((f) => [f.relative, f] as const))('%s', (_name, f) => {
    const path = `/api/v1/entry-exports/${f.export}/download`;
    expect(signRelativeUrl(path, f.now + f.minutes * 60, f.key)).toBe(
      f.relative,
    );

    const query = f.relative.split('?')[1];
    expect(checkRelativeSignature(path, query, f.key, f.now)).toBe('valid');
    expect(
      checkRelativeSignature(path, query, f.key, f.now + f.minutes * 60 + 1),
    ).toBe('expired');
    expect(checkRelativeSignature(path, query, 'other-key', f.now)).toBe(
      'invalid',
    );
    expect(
      checkRelativeSignature(
        path,
        query.replace(/expires=\d+/, 'expires=9999999999'),
        f.key,
        f.now,
      ),
    ).toBe('invalid');
    expect(
      checkRelativeSignature(
        path.replace('/download', '/x'),
        query,
        f.key,
        f.now,
      ),
    ).toBe('invalid');
    expect(
      checkRelativeSignature(
        path,
        query.replace(/&signature=.*/, ''),
        f.key,
        f.now,
      ),
    ).toBe('invalid');
  });
});
