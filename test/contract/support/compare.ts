/**
 * JSON parity is defined as equal parsed values **with equal key order**
 * (ch. 3 §3.2): Laravel escapes `/` and non-ASCII, Node doesn't, so bytes
 * differ while values match.
 */
export function orderedEntries(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedEntries);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      orderedEntries(v),
    ]);
  }
  return value;
}

/** Asserts equal values and equal key order at every level. */
export function expectSameJson(actual: unknown, expected: unknown): void {
  expect(orderedEntries(actual)).toEqual(orderedEntries(expected));
}

const ULID = /\b[0-7][0-9a-hjkmnp-tv-z]{25}\b/gi;
const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\b/g;

/**
 * Replaces values that differ between runs and servers: model IDs,
 * timestamps, tokens and signatures. Whole-number floats need no handling
 * once parsed (`1.0` and `1` are the same JS number).
 */
export function normalise<T>(value: T, keepIds: string[] = []): T {
  const ids = new Map<string, string>();
  const json = JSON.stringify(value)
    .replace(ULID, (id) => {
      if (keepIds.includes(id)) return id;
      const key = id.toLowerCase();
      if (!ids.has(key)) ids.set(key, `<ulid:${ids.size + 1}>`);
      return ids.get(key) as string;
    })
    .replace(TIMESTAMP, '<timestamp>')
    .replace(/("access_token":")[^"]+"/g, '$1<token>"')
    .replace(/(signature=)[0-9a-f]+/g, '$1<signature>')
    .replace(/(expires=)\d+/g, '$1<expires>');
  return JSON.parse(json) as T;
}

/** Laravel's 422 body for these errors: the first message plus "(and N more errors)". */
export function validationBody(errors: Record<string, string[]>): {
  message: string;
  errors: Record<string, string[]>;
} {
  const messages = Object.values(errors).flat();
  const more = messages.length - 1;
  return {
    message:
      more === 0
        ? messages[0]
        : `${messages[0]} (and ${more} more ${more === 1 ? 'error' : 'errors'})`,
    errors,
  };
}
