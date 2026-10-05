import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { currentDbType } from '../common/db/column-types';
import { newUlid } from '../common/db/ulid';
import { toLaravelBoolean } from '../common/http/laravel-boolean';
import { strLimit } from '../common/support/str';
import { isPlainObject, toPhpShape } from '../common/validation/php';
import { FormEntry } from '../form-entries/form-entry.entity';
import type { FormField } from './form-field';
import { withSettingsDefaults, type FormSettings } from './form-settings';
import { Form } from './form.entity';
import type { FormEntryCounts } from './form.resource';
import type {
  FormSortColumn,
  FormStoreInput,
  FormUpdateInput,
} from './rules/form.rules';

export interface FormListQuery {
  active: boolean | null;
  sort: FormSortColumn;
  direction: 'ASC' | 'DESC';
  page: number;
  perPage: number;
}

export interface FormListPage {
  items: { form: Form; counts: FormEntryCounts }[];
  total: number;
}

/**
 * The `FormSettings` cast: settings are stored with all six keys, booleans
 * coerced, and lists in PHP's shape. `{}` / `[]` give the defaults.
 */
export function settingsFromInput(value: unknown): FormSettings | null {
  if (value === null || value === undefined) return null;
  const settings = withSettingsDefaults(isPlainObject(value) ? value : {});
  settings.honeypot_enabled = toLaravelBoolean(settings.honeypot_enabled);
  settings.domains = toPhpShape(settings.domains) as string[] | null;
  return settings;
}

/** The `array` cast: stored as `json_encode` writes it. */
function schemaFromInput(value: unknown): FormField[] | null {
  return (toPhpShape(value) ?? null) as FormField[] | null;
}

@Injectable()
export class FormsService {
  constructor(
    @InjectRepository(Form) private readonly forms: Repository<Form>,
    private readonly clock: Clock,
  ) {}

  /**
   * `FormController::index()`: the user's forms with entry counts (each
   * excluding deleted entries), sorted by the column then `id` in the same
   * direction. `name` sorts by `lower(name)` in byte order, as SQLite does.
   */
  async paginateForUser(
    userId: number,
    query: FormListQuery,
  ): Promise<FormListPage> {
    const base = this.forms
      .createQueryBuilder('form')
      .where('form.user_id = :userId', { userId });
    if (query.active !== null)
      base.andWhere('form.active = :active', { active: query.active });

    const total = await base.getCount();
    if (total === 0) return { items: [], total };

    const sort =
      query.sort === 'name'
        ? `lower(form.name)${currentDbType() === 'postgres' ? ' COLLATE "C"' : ''}`
        : query.sort === 'created_at'
          ? 'form.createdAt'
          : 'form.updatedAt';

    const { entities, raw } = await this.withEntryCounts(base)
      .orderBy(sort, query.direction)
      .addOrderBy('form.id', query.direction)
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage)
      .getRawAndEntities<Record<keyof FormEntryCounts, unknown>>();

    return {
      items: entities.map((form, index) => ({
        form,
        counts: {
          entries_count: Number(raw[index].entries_count),
          unread_entries_count: Number(raw[index].unread_entries_count),
          spam_entries_count: Number(raw[index].spam_entries_count),
        },
      })),
      total,
    };
  }

  /** `withCount()` for the three entry counts, as subqueries. */
  private withEntryCounts(
    query: SelectQueryBuilder<Form>,
  ): SelectQueryBuilder<Form> {
    const count = (alias: keyof FormEntryCounts, condition: string) =>
      query.addSelect(
        (sub) =>
          sub
            .select('COUNT(*)')
            .from(FormEntry, 'entry')
            .where('entry.form_id = form.id')
            .andWhere('entry.deleted_at IS NULL')
            .andWhere(condition),
        alias,
      );
    count('entries_count', '(entry.spam = :notSpam OR entry.spam IS NULL)');
    count(
      'unread_entries_count',
      '(entry.spam = :notSpam OR entry.spam IS NULL) AND entry.read_at IS NULL',
    );
    count('spam_entries_count', 'entry.spam = :spam');
    return query.setParameters({ notSpam: false, spam: true });
  }

  /** `$user->forms()->create($validated)`: `active` always starts false. */
  create(userId: number, input: FormStoreInput): Promise<Form> {
    return this.forms.save(
      this.forms.create({
        id: newUlid(),
        userId,
        name: input.name,
        active: false,
        schema: 'schema' in input ? schemaFromInput(input.schema) : null,
        settings:
          'settings' in input ? settingsFromInput(input.settings) : null,
      }),
    );
  }

  /** `$form->update($validated)`: omitted `schema` / `settings` are kept. */
  update(form: Form, input: FormUpdateInput): Promise<Form> {
    form.name = input.name;
    form.active = toLaravelBoolean(input.active);
    if ('schema' in input) form.schema = schemaFromInput(input.schema);
    if ('settings' in input) form.settings = settingsFromInput(input.settings);
    return this.forms.save(form);
  }

  /** Soft delete, setting `updated_at` too, as Eloquent does. */
  async delete(form: Form): Promise<void> {
    const now = this.clock.now();
    await this.forms.update(
      { id: form.id },
      { deletedAt: now, updatedAt: now },
    );
  }

  /** `$form->restore()`: a form that isn't deleted is left untouched. */
  async restore(form: Form): Promise<Form> {
    if (form.deletedAt === null) return form;
    const now = this.clock.now();
    await this.forms.update(
      { id: form.id },
      { deletedAt: null, updatedAt: now },
    );
    return this.forms.findOneByOrFail({ id: form.id });
  }

  /** `DuplicateForm`: same owner, schema and settings; inactive; "(copy)" name. */
  duplicate(form: Form): Promise<Form> {
    return this.forms.save(
      this.forms.create({
        id: newUlid(),
        userId: form.userId,
        name: `${strLimit(form.name, 393, '')} (copy)`,
        active: false,
        schema: form.schema,
        settings:
          form.settings === null ? null : withSettingsDefaults(form.settings),
      }),
    );
  }
}
