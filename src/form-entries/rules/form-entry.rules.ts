import { DataSource } from 'typeorm';
import type { ValidationRequestContext } from '../../common/validation/validated.decorator';
import type { RuleObject, RuleSet } from '../../common/validation/validator';
import { ownedForm } from '../../forms/form-ownership.guard';
import { MAX_PER_PAGE } from '../../forms/rules/form.rules';
import { FormEntry } from '../form-entry.entity';

/** Columns the entry list sorts by; `-` prefix for descending. */
export const ENTRY_SORTABLE = ['created_at', 'spam_score'] as const;
export type EntrySortColumn = (typeof ENTRY_SORTABLE)[number];

/** Filters accepted under `filter[...]`. */
export const ENTRY_FILTERS = [
  'read',
  'starred',
  'spam',
  'created_from',
  'created_to',
  'trashed',
] as const;

const BOOLEAN_FILTER = ['sometimes', 'in:true,false,1,0'];

/**
 * `FormEntryIndexRequest::rules()`. Also validates an export's parameters
 * (ch. 3 §3.7), where `per_page` is accepted and ignored.
 */
export const formEntryIndexRules: RuleSet = {
  per_page: ['sometimes', 'integer', `between:1,${MAX_PER_PAGE}`],
  sort: [
    'sometimes',
    'string',
    `in:${ENTRY_SORTABLE.flatMap((c) => [c, `-${c}`]).join(',')}`,
  ],
  filter: ['sometimes', `array:${ENTRY_FILTERS.join(',')}`],
  'filter.read': BOOLEAN_FILTER,
  'filter.starred': BOOLEAN_FILTER,
  'filter.spam': BOOLEAN_FILTER,
  'filter.created_from': ['sometimes', 'date_format:Y-m-d'],
  'filter.created_to': [
    'sometimes',
    'date_format:Y-m-d',
    'after_or_equal:filter.created_from',
  ],
  'filter.trashed': ['sometimes', 'in:with,only'],
};

type BooleanFilter = 'true' | 'false' | '1' | '0';

/** The validated sort and filters (`FormEntryIndexRequest::parameters()`). */
export interface EntryListParameters {
  sort?: string;
  filter?: {
    read?: BooleanFilter;
    starred?: BooleanFilter;
    spam?: BooleanFilter;
    created_from?: string;
    created_to?: string;
    trashed?: 'with' | 'only';
  };
}

export interface FormEntryIndexInput extends EntryListParameters {
  per_page?: string | number;
}

/**
 * What was submitted, and where from, is fixed at submission time. These are
 * rejected when sent at all, even as null, rather than ignored.
 */
export const SUBMISSION_FIELDS = [
  'input',
  'ip',
  'ip_location_display',
  'referer',
  'user_agent',
  'user_agent_display',
] as const;

/** `FormEntryUpdateRequest::rules()`: every triage field is optional. */
export const formEntryUpdateRules: RuleSet = {
  ...Object.fromEntries(SUBMISSION_FIELDS.map((field) => [field, ['missing']])),
  spam_checked_at: ['missing'],
  spam: ['nullable', 'boolean'],
  spam_score: ['sometimes', 'required', 'numeric', 'between:0,9.99'],
  spam_reason: ['nullable', 'string'],
  starred: ['sometimes', 'required', 'boolean'],
  read_at: ['nullable', 'date'],
};

export interface FormEntryUpdateInput {
  spam?: boolean | 0 | 1 | '0' | '1' | null;
  spam_score?: number | string;
  spam_reason?: string | null;
  starred?: boolean | 0 | 1 | '0' | '1';
  read_at?: string | number | null;
}

/** Bulk actions for entries that aren't deleted. */
export const ACTIONS_FOR_ENTRIES = [
  'mark_read',
  'mark_unread',
  'star',
  'unstar',
  'mark_spam',
  'mark_not_spam',
  'delete',
] as const;

/** Bulk actions for deleted entries. */
export const ACTIONS_FOR_DELETED_ENTRIES = ['restore', 'force_delete'] as const;

export type BulkAction =
  | (typeof ACTIONS_FOR_ENTRIES)[number]
  | (typeof ACTIONS_FOR_DELETED_ENTRIES)[number];

export const MAX_BULK_IDS = 100;

/**
 * `Rule::exists('form_entries', 'id')->where('form_id', …)` plus the deleted
 * state the action needs.
 */
function entryOfForm(
  dataSource: DataSource,
  formId: string,
  deleted: boolean,
): RuleObject {
  return {
    name: 'exists',
    check: (value) =>
      dataSource
        .getRepository(FormEntry)
        .createQueryBuilder('entry')
        .withDeleted()
        .where('entry.id = :id', { id: value })
        .andWhere('entry.form_id = :formId', { formId })
        .andWhere(
          deleted ? 'entry.deleted_at IS NOT NULL' : 'entry.deleted_at IS NULL',
        )
        .getExists(),
  };
}

/** `FormEntryBulkRequest::rules()`. */
export function formEntryBulkRules(ctx: ValidationRequestContext): RuleSet {
  const actsOnDeleted = (
    ACTIONS_FOR_DELETED_ENTRIES as readonly unknown[]
  ).includes(ctx.input.action);
  return {
    action: [
      'required',
      'string',
      `in:${[...ACTIONS_FOR_ENTRIES, ...ACTIONS_FOR_DELETED_ENTRIES].join(',')}`,
    ],
    ids: ['required', 'array', 'min:1', `max:${MAX_BULK_IDS}`],
    'ids.*': [
      'required',
      'string',
      'distinct',
      entryOfForm(
        ctx.resolve(DataSource),
        ownedForm(ctx.req).id,
        actsOnDeleted,
      ),
    ],
  };
}

export interface FormEntryBulkInput {
  action: BulkAction;
  ids: string[];
}
