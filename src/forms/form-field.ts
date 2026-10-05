/** One entry of `forms.schema`, which is a list (ch. 2 §2.3). */
export interface FormField {
  /** ULID, unique within the schema. Usually uppercase; compared exactly. */
  id: string;
  order: number;
  label?: string | null;
  /** Input name; defaults to `id`. */
  name?: string | null;
  /** Laravel rule strings. */
  rules?: string[] | string | null;
}

/**
 * Fields sorted by `order`. `Array.prototype.sort` is stable, so ties keep
 * their stored order, as Laravel's `sortBy` does. The stored schema keeps the
 * client's order; only presentation sorts.
 */
export function orderedSchema(
  schema: readonly FormField[] | null,
): FormField[] {
  return [...(schema ?? [])].sort((a, b) => a.order - b.order);
}
