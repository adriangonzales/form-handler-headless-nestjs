import { isPhpArray, phpString } from '../../common/validation/php';
import { isSupportedRule } from '../../common/validation/validator';
import type { FormField } from '../form-field';

/**
 * `BuildValidationRules` (ch. 4 §4.1): the schema's rules keyed by each
 * field's input name (`name`, else `id`). Stored order, so a later field with
 * the same input name wins. No rules means `sometimes`; a string is split on
 * commas, so `"in:a,b"` breaks into `in:a` and `b` (F7 rejects that on save).
 */
export function buildRules(
  schema: readonly FormField[] | null,
): Record<string, string[]> {
  const rules: Record<string, string[]> = {};
  for (const field of schema ?? []) {
    const fieldRules = field.rules ?? ['sometimes'];
    rules[field.name ?? field.id] =
      typeof fieldRules === 'string'
        ? fieldRules.split(',')
        : Object.values(fieldRules);
  }
  return rules;
}

/**
 * F7 (ch. 4 §4.5): the names of a field's rules, as `buildRules` would
 * produce them, that the engine can't run. Each name once, in order.
 */
export function unsupportedRuleNames(rules: unknown): string[] {
  if (rules === null || rules === undefined) return [];
  if (!isPhpArray(rules) && typeof rules !== 'string') {
    // Laravel can't iterate a scalar rule list either.
    return [phpString(rules)];
  }
  const list =
    typeof rules === 'string' ? rules.split(',') : Object.values(rules);
  const names: string[] = [];
  for (const rule of list) {
    if (typeof rule !== 'string' || isSupportedRule(rule)) continue;
    const name = rule.split(':')[0].trim();
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
