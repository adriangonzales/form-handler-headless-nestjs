import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePhpQuery } from './php-input';

const corpus = JSON.parse(
  readFileSync(
    join(__dirname, '../../../test/fixtures/validation/corpus.json'),
    'utf8',
  ),
) as { queries: [string, string][] };

describe('parsePhpQuery vs PHP parse_str()', () => {
  it.each(corpus.queries)('%j', (query, php) => {
    const ours = parsePhpQuery(query);
    expect(ours).toEqual(JSON.parse(php));
    // Key order too (JS reorders integer-like keys, so compare where PHP's order is representable).
    if (!/"-?\d+":/.test(php)) expect(JSON.stringify(ours)).toBe(php);
  });
});
