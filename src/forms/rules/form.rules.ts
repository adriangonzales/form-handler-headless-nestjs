import { mergeInput } from '../../common/http/request-input';
import { isPhpArray } from '../../common/validation/php';
import type { ValidationRequestContext } from '../../common/validation/validated.decorator';
import {
  type AfterHook,
  type RuleSet,
  type ValidationContext,
} from '../../common/validation/validator';
import type { FormField } from '../form-field';
import { ownedForm } from '../form-ownership.guard';
import type { Form } from '../form.entity';
import { FORM_SETTINGS_DEFAULTS, withSettingsDefaults } from '../form-settings';
import { generateHoneypotName } from '../generate-honeypot-name';
import { unsupportedRuleNames } from '../schema-rules/build-rules';

/** Largest page size a client may request with `per_page`. */
export const MAX_PER_PAGE = 100;
export const DEFAULT_PER_PAGE = 15;

/** Columns the form list sorts by; `-` prefix for descending. */
export const FORM_SORTABLE = ['created_at', 'updated_at', 'name'] as const;
export type FormSortColumn = (typeof FORM_SORTABLE)[number];

const FORM_SORTS = FORM_SORTABLE.flatMap((column) => [column, `-${column}`]);

/** `FormIndexRequest::rules()`. */
export const formIndexRules: RuleSet = {
  per_page: ['sometimes', 'integer', `between:1,${MAX_PER_PAGE}`],
  sort: ['sometimes', 'string', `in:${FORM_SORTS.join(',')}`],
  filter: ['sometimes', 'array:active'],
  'filter.active': ['sometimes', 'in:true,false,1,0'],
};

export interface FormIndexInput {
  per_page?: string | number;
  sort?: string;
  filter?: { active?: 'true' | 'false' | '1' | '0' };
}

/** The structural schema rules shared by store and update. */
const SCHEMA_RULES: RuleSet = {
  schema: ['nullable', 'list'],
  'schema.*': ['array:id,order,label,name,rules'],
  'schema.*.id': ['required', 'ulid', 'distinct'],
  'schema.*.order': ['required', 'integer'],
  'schema.*.label': ['nullable', 'string'],
  'schema.*.name': ['nullable', 'string'],
  'schema.*.rules': ['nullable'],
  'schema.*.rules.*': ['string'],
};

const SETTINGS_KEYS = Object.keys(FORM_SETTINGS_DEFAULTS);

/**
 * `FormSettings::getValidationRules($settings)` (spatie/laravel-data) under
 * `settings.`: a property's rules only when its key was sent, except
 * `domains` and `honeypot_name` (from `FormSettings::rules()`), which are
 * always there; `domains.*` comes last. Checked against PHP output.
 */
function settingsFieldRules(settings: unknown): RuleSet {
  if (!isPhpArray(settings)) return {};
  const sent = (key: string) => Object.hasOwn(settings, key);
  const rules: RuleSet = {};
  if (sent('redirect'))
    rules['settings.redirect'] = ['nullable', 'string', 'url', 'max:2048'];
  if (sent('timezone'))
    rules['settings.timezone'] = ['nullable', 'string', 'timezone'];
  rules['settings.domains'] = ['nullable', 'array', 'list'];
  if (sent('message'))
    rules['settings.message'] = ['nullable', 'string', 'max:2000'];
  if (sent('honeypot_enabled'))
    rules['settings.honeypot_enabled'] = ['required', 'boolean'];
  rules['settings.honeypot_name'] = [
    'nullable',
    'string',
    'max:255',
    'regex:/^[A-Za-z0-9_-]+$/',
  ];
  rules['settings.domains.*'] = [
    'required',
    'string',
    'max:253',
    'regex:/^(?=.{1,253}$)(\\*\\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i',
  ];
  return rules;
}

function settingsRules(input: Record<string, unknown>): RuleSet {
  return {
    settings: ['nullable', `array:${SETTINGS_KEYS.join(',')}`],
    ...settingsFieldRules(input.settings),
  };
}

/** `FormStoreRequest::rules()`. */
export function formStoreRules({ input }: ValidationRequestContext): RuleSet {
  return {
    name: ['required', 'string', 'max:400'],
    ...SCHEMA_RULES,
    ...settingsRules(input),
  };
}

/** `FormUpdateRequest::rules()`. */
export function formUpdateRules({ input }: ValidationRequestContext): RuleSet {
  return {
    name: ['required', 'string', 'max:400'],
    active: ['required', 'boolean'],
    ...SCHEMA_RULES,
    ...settingsRules(input),
  };
}

export interface FormStoreInput {
  name: string;
  schema?: FormField[] | null;
  settings?: Record<string, unknown> | unknown[] | null;
}

export interface FormUpdateInput extends FormStoreInput {
  active: boolean | 0 | 1 | '0' | '1';
}

/** The form being updated, or null on create. */
function routeForm(ctx: ValidationRequestContext): Form | null {
  return ctx.req.params.form === undefined ? null : ownedForm(ctx.req);
}

/**
 * The input names a schema accepts, as `buildRules` keys them: a field's
 * `name`, else its `id` (`schemaInputNames()`).
 */
function schemaInputNames(schema: unknown): string[] {
  if (!isPhpArray(schema)) return [];
  const names: string[] = [];
  for (const field of Object.values(schema)) {
    if (!isPhpArray(field) || Array.isArray(field)) continue;
    const name = field.name ?? field.id ?? null;
    if (typeof name === 'string') names.push(name);
  }
  return names;
}

function settingValue(settings: unknown, key: string): unknown {
  return isPhpArray(settings) && Object.hasOwn(settings, key)
    ? (settings as Record<string, unknown>)[key]
    : undefined;
}

/**
 * `fillDefaultHoneypotName()`: when settings are sent with the honeypot
 * enabled but no name, keep the form's stored name if it doesn't clash with
 * the schema, else generate one that doesn't. Runs before validation.
 */
export function fillDefaultHoneypotName(ctx: ValidationRequestContext): void {
  const { input } = ctx;
  const settings = input.settings;
  if (
    !isPhpArray(settings) ||
    Array.isArray(settings) ||
    ![true, 1, '1'].includes(
      (settingValue(settings, 'honeypot_enabled') ?? false) as never,
    )
  ) {
    return;
  }
  const current = settingValue(settings, 'honeypot_name') ?? null;
  if (current !== null && current !== '') return;

  const form = routeForm(ctx);
  const schema = Object.hasOwn(input, 'schema') ? input.schema : form?.schema;
  const taken = schemaInputNames(schema);
  const stored = form?.settings
    ? withSettingsDefaults(form.settings).honeypot_name
    : null;

  mergeInput(ctx.req, {
    settings: {
      ...settings,
      honeypot_name:
        stored !== null && !taken.includes(stored)
          ? stored
          : generateHoneypotName(taken),
    },
  });
}

/**
 * F7 (ch. 4 §4.5): every rule name in a structurally valid schema field must
 * be one the engine supports, or saving fails on `schema.N.rules`. Laravel
 * accepts such a form and then fails every submission with a 500.
 */
function supportedRulesCheck(): AfterHook {
  return (validator) => {
    if (validator.hasErrors('schema')) return;
    const schema = validator.getValue('schema');
    if (!isPhpArray(schema)) return;

    for (const [index, field] of Object.entries(schema)) {
      const key = `schema.${index}`;
      if (!isPhpArray(field) || fieldHasErrors(validator, key, field)) continue;
      for (const name of unsupportedRuleNames(
        (field as Record<string, unknown>).rules,
      )) {
        validator.addError(
          `${key}.rules`,
          `The ${key}.rules field contains an unsupported rule: ${name}.`,
        );
      }
    }
  };
}

function fieldHasErrors(
  validator: ValidationContext,
  key: string,
  field: object,
): boolean {
  const rules = (field as Record<string, unknown>).rules;
  const keys = [
    key,
    ...['id', 'order', 'label', 'name', 'rules'].map((k) => `${key}.${k}`),
    ...(isPhpArray(rules)
      ? Object.keys(rules).map((k) => `${key}.rules.${k}`)
      : []),
  ];
  return keys.some((k) => validator.hasErrors(k));
}

/**
 * `honeypotNameCheck()`: the honeypot name must not be one of the schema's
 * input names, or every real submission would be flagged as spam. Omitted
 * settings or schema fall back to the stored ones. The error goes on the
 * honeypot name when settings were sent, else on the schema.
 */
function honeypotNameCheck(ctx: ValidationRequestContext): AfterHook {
  return (validator) => {
    const { input } = ctx;
    const form = routeForm(ctx);
    const settingsSent = Object.hasOwn(input, 'settings');
    const settings = settingsSent
      ? input.settings
      : form?.settings
        ? withSettingsDefaults(form.settings)
        : null;
    const schema = Object.hasOwn(input, 'schema') ? input.schema : form?.schema;
    const honeypotName = settingValue(settings, 'honeypot_name') ?? null;

    if (typeof honeypotName !== 'string' || !isPhpArray(schema)) return;
    if (!schemaInputNames(schema).includes(honeypotName)) return;

    if (settingsSent) {
      validator.addError(
        'settings.honeypot_name',
        'The honeypot name must not match a schema field.',
      );
    } else {
      validator.addError(
        'schema',
        'The schema must not contain a field named after the honeypot.',
      );
    }
  };
}

/** `after()` for store and update: F7, then the honeypot clash check. */
export function formAfterHooks(ctx: ValidationRequestContext): AfterHook[] {
  return [supportedRulesCheck(), honeypotNameCheck(ctx)];
}
