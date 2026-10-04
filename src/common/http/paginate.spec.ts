import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paginationEnvelope, resolvePage } from './paginate';
import { parsePhpQuery } from './php-input';
import { asBag, cleanInput } from './request-input';

interface Fixture {
  uri: string;
  total: number;
  perPage: number;
  keepQuery: boolean;
  json: string;
}

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, '../../../test/fixtures/laravel/golden/pagination.json'),
    'utf8',
  ),
) as Fixture[];

describe('paginationEnvelope vs Laravel (golden fixtures)', () => {
  it.each(
    fixtures.map(
      (f) => [`${f.uri} total=${f.total} per=${f.perPage}`, f] as const,
    ),
  )('%s', (_name, f) => {
    const url = new URL(f.uri);
    const query = cleanInput(asBag(parsePhpQuery(url.search.slice(1))));
    const page = resolvePage(query.page);
    const items: { id: number }[] = [];
    for (
      let i = (page - 1) * f.perPage + 1;
      i <= Math.min(f.total, page * f.perPage);
      i++
    ) {
      items.push({ id: i });
    }
    const envelope = paginationEnvelope(items, f.total, f.perPage, page, {
      path: `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, ''),
      query: f.keepQuery ? query : null,
    });
    // Parsed values with key order (Laravel escapes "/", Node doesn't).
    expect(JSON.stringify(envelope)).toBe(JSON.stringify(JSON.parse(f.json)));
  });
});
