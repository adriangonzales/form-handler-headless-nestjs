import type { Repository, SelectQueryBuilder } from 'typeorm';
import { parseFilterBoolean } from '../common/http/laravel-boolean';
import type { FormEntry } from './form-entry.entity';
import type {
  EntryListParameters,
  EntrySortColumn,
} from './rules/form-entry.rules';

/**
 * `FilterEntries`: the form's entries for validated list parameters, sorted
 * by the column then `id` in the same direction. Shared with exports (ch. 6).
 */
export function filterEntries(
  entries: Repository<FormEntry>,
  formId: string,
  parameters: EntryListParameters,
): SelectQueryBuilder<FormEntry> {
  const filter = parameters.filter ?? {};
  const sort = parameters.sort ?? 'created_at';
  const column = sort.replace(/^-/, '') as EntrySortColumn;
  const direction = sort.startsWith('-') ? 'DESC' : 'ASC';
  const flag = (value: 'true' | 'false' | '1' | '0' | undefined) =>
    value === undefined ? null : parseFilterBoolean(value);

  const query = entries
    .createQueryBuilder('entry')
    .where('entry.form_id = :formId', { formId });

  if (filter.trashed !== undefined) query.withDeleted();
  if (filter.trashed === 'only') query.andWhere('entry.deleted_at IS NOT NULL');

  const read = flag(filter.read);
  if (read !== null)
    query.andWhere(
      read ? 'entry.read_at IS NOT NULL' : 'entry.read_at IS NULL',
    );

  const starred = flag(filter.starred);
  if (starred !== null) query.andWhere('entry.starred = :starred', { starred });

  const spam = flag(filter.spam);
  if (spam === true) query.andWhere('entry.spam = :spam', { spam: true });
  if (spam === false)
    query.andWhere('(entry.spam = :notSpam OR entry.spam IS NULL)', {
      notSpam: false,
    });

  // `startOfDay()` / `endOfDay()`; the column holds whole seconds.
  if (filter.created_from !== undefined)
    query.andWhere('entry.created_at >= :createdFrom', {
      createdFrom: new Date(`${filter.created_from}T00:00:00Z`),
    });
  if (filter.created_to !== undefined)
    query.andWhere('entry.created_at <= :createdTo', {
      createdTo: new Date(`${filter.created_to}T23:59:59Z`),
    });

  return query
    .orderBy(
      column === 'created_at' ? 'entry.createdAt' : 'entry.spamScore',
      direction,
    )
    .addOrderBy('entry.id', direction);
}
