import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type WhereExpressionBuilder } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { phpRound } from '../common/db/spam-score.transformer';
import { toLaravelBoolean } from '../common/http/laravel-boolean';
import { eloquentDateTime } from '../common/validation/date';
import type { Form } from '../forms/form.entity';
import { limitColumn } from './create-form-entry.service';
import { filterEntries } from './filter-entries';
import { FormEntry } from './form-entry.entity';
import type {
  BulkAction,
  EntryListParameters,
  FormEntryUpdateInput,
} from './rules/form-entry.rules';

@Injectable()
export class FormEntriesService {
  constructor(
    @InjectRepository(FormEntry)
    private readonly entries: Repository<FormEntry>,
    private readonly clock: Clock,
  ) {}

  /** A page of the form's entries (`FilterEntries` + `paginate()`). */
  async paginate(
    form: Form,
    parameters: EntryListParameters,
    page: number,
    perPage: number,
  ): Promise<{ items: FormEntry[]; total: number }> {
    const query = filterEntries(this.entries, form.id, parameters);
    const total = await query.getCount();
    if (total === 0) return { items: [], total };
    const items = await query
      .limit(perPage)
      .offset((page - 1) * perPage)
      .getMany();
    return { items, total };
  }

  /** `$entry->update($validated)`, then `fresh()`: only the sent fields change. */
  async update(
    entry: FormEntry,
    input: FormEntryUpdateInput,
  ): Promise<FormEntry> {
    if (input.spam !== undefined)
      entry.spam = input.spam === null ? null : toLaravelBoolean(input.spam);
    if (input.spam_score !== undefined)
      entry.spamScore = phpRound(Number(input.spam_score), 2);
    if (input.spam_reason !== undefined)
      // Laravel sets no maximum; cut to the column so Postgres accepts it.
      entry.spamReason =
        input.spam_reason === null ? null : limitColumn(input.spam_reason);
    if (input.starred !== undefined)
      entry.starred = toLaravelBoolean(input.starred);
    if (input.read_at !== undefined)
      entry.readAt = eloquentDateTime(input.read_at);
    await this.entries.save(entry);
    return this.entries.findOneOrFail({
      where: { id: entry.id },
      withDeleted: true,
    });
  }

  /** Soft delete, setting `updated_at` too, as Eloquent does. */
  async delete(entry: FormEntry): Promise<void> {
    const now = this.clock.now();
    await this.entries.update(
      { id: entry.id },
      { deletedAt: now, updatedAt: now },
    );
  }

  /** `$entry->restore()`: an entry that isn't deleted is left untouched. */
  async restore(entry: FormEntry): Promise<FormEntry> {
    if (entry.deletedAt === null) return entry;
    const now = this.clock.now();
    await this.entries.update(
      { id: entry.id },
      { deletedAt: null, updatedAt: now },
    );
    entry.deletedAt = null;
    entry.updatedAt = now;
    return entry;
  }

  async forceDelete(entry: FormEntry): Promise<void> {
    await this.entries.delete({ id: entry.id });
  }

  /**
   * `ApplyBulkAction`: applies the action to the form's selected entries and
   * returns how many changed. Triage actions skip entries already in the
   * target state; every write sets `updated_at`, as Eloquent's builder does.
   */
  async bulk(form: Form, action: BulkAction, ids: string[]): Promise<number> {
    const now = this.clock.now();
    const selected = (query: WhereExpressionBuilder, deleted: boolean) =>
      query
        .where('form_id = :formId', { formId: form.id })
        .andWhere('id IN (:...ids)', { ids })
        .andWhere(deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
    const update = async (
      values: Partial<Record<keyof FormEntry, unknown>>,
      condition: string | null,
      deleted = false,
    ) => {
      const query = this.entries
        .createQueryBuilder()
        .update(FormEntry)
        .set({ ...values, updatedAt: now } as never);
      selected(query, deleted);
      if (condition !== null)
        query.andWhere(condition, { yes: true, no: false });
      return (await query.execute()).affected ?? 0;
    };

    switch (action) {
      case 'mark_read':
        return update({ readAt: now }, 'read_at IS NULL');
      case 'mark_unread':
        return update({ readAt: null }, 'read_at IS NOT NULL');
      case 'star':
        return update({ starred: true }, 'starred = :no');
      case 'unstar':
        return update({ starred: false }, 'starred = :yes');
      case 'mark_spam':
        return update({ spam: true }, '(spam = :no OR spam IS NULL)');
      case 'mark_not_spam':
        return update({ spam: false }, '(spam = :yes OR spam IS NULL)');
      case 'delete':
        return update({ deletedAt: now }, null);
      case 'restore':
        return update({ deletedAt: null }, null, true);
      case 'force_delete': {
        const query = this.entries
          .createQueryBuilder()
          .delete()
          .from(FormEntry);
        selected(query, true);
        return (await query.execute()).affected ?? 0;
      }
    }
  }
}
