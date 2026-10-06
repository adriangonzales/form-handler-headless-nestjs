import { dataGet, MISSING } from '../common/validation/data';
import type { FormEntry } from '../form-entries/form-entry.entity';
import type { Form } from './form.entity';

export interface MappedField {
  label: string;
  data: unknown;
}

/**
 * `MapFormData` (ch. 4 §4.6): each field's label and submitted value, keyed
 * by field ID in `order` order. Values are looked up under the field's input
 * name (`name ?? id`) with dot paths, as `Arr::get` does.
 */
export function mapFormData(
  form: Form,
  entry: FormEntry,
): Record<string, MappedField> {
  const out: Record<string, MappedField> = {};
  for (const field of form.orderedSchema()) {
    out[field.id] = {
      label: field.label ?? field.id,
      data: arrGet(entry.input ?? {}, field.name ?? field.id),
    };
  }
  return out;
}

/** `Arr::get($array, $key)`: a literal key wins over a dot path; missing is null. */
function arrGet(input: unknown, key: string): unknown {
  if (
    input !== null &&
    typeof input === 'object' &&
    Object.hasOwn(input, key)
  ) {
    return (input as Record<string, unknown>)[key];
  }
  const value = dataGet(input, key);
  return value === MISSING ? null : value;
}
