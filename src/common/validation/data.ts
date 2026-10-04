/**
 * Dotted-path helpers over decoded input, ports of `Arr::get`, `Arr::has`,
 * `Arr::dot`, `Arr::set`, `data_set` and `ValidationData`.
 *
 * Input is JSON-shaped: arrays and plain objects (both PHP arrays). Keys that
 * themselves contain dots are never traversed, as in Laravel's validator.
 */
import { isPhpArray, type PlainObject } from './php';

export const MISSING: unique symbol = Symbol('missing');

/** Returns `MISSING` when the key is absent. */
function child(container: unknown, key: string): unknown {
  if (Array.isArray(container)) {
    return /^(0|[1-9]\d*)$/.test(key) && Number(key) < container.length
      ? container[Number(key)]
      : MISSING;
  }
  if (
    isPhpArray(container) &&
    Object.prototype.hasOwnProperty.call(container, key)
  ) {
    return (container as PlainObject)[key];
  }
  return MISSING;
}

/** `Arr::get($data, $path)` with a sentinel for "missing". */
export function dataGet(data: unknown, path: string | null): unknown {
  if (path === null) return data;
  let current: unknown = data;
  for (const segment of path.split('.')) {
    current = child(current, segment);
    if (current === MISSING) return MISSING;
  }
  return current;
}

/** `Arr::has($data, $path)`: the key exists, even when its value is null. */
export function dataHas(data: unknown, path: string): boolean {
  return dataGet(data, path) !== MISSING;
}

/** `Arr::dot()`: leaf keys (and empty arrays) in depth-first order. */
export function arrDot(data: unknown, prefix = ''): [string, unknown][] {
  if (!isPhpArray(data)) return [];
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (isPhpArray(value) && Object.keys(value).length > 0) {
      out.push(...arrDot(value, `${prefix}${key}.`));
    } else {
      out.push([`${prefix}${key}`, value]);
    }
  }
  return out;
}

/** Deep copy with arrays as index-keyed objects, so `data_set` can add any key. */
function toRecord(value: unknown): unknown {
  if (!isPhpArray(value)) return value;
  const out: PlainObject = {};
  for (const [key, inner] of Object.entries(value)) out[key] = toRecord(inner);
  return out;
}

/** `data_set($target, $segments, $value, overwrite: true)` on a record copy. */
function dataSet(target: unknown, segments: string[], value: unknown): unknown {
  const [segment, ...rest] = segments;
  if (segment === '*') {
    const record = isPhpArray(target) ? (target as PlainObject) : {};
    for (const key of Object.keys(record)) {
      record[key] = rest.length > 0 ? dataSet(record[key], rest, value) : value;
    }
    return record;
  }
  const record = isPhpArray(target) ? (target as PlainObject) : {};
  if (rest.length > 0) {
    const inner = Object.prototype.hasOwnProperty.call(record, segment)
      ? record[segment]
      : {};
    record[segment] = dataSet(inner, rest, value);
  } else {
    record[segment] = value;
  }
  return record;
}

/** `ValidationData::getLeadingExplicitAttributePath()`. */
export function leadingExplicitPath(attribute: string): string | null {
  return attribute.split('*')[0].replace(/\.+$/, '') || null;
}

/** `ValidationData::extractDataFromPath()`: only the subtree at `path`. */
export function extractDataFromPath(
  path: string | null,
  data: unknown,
): unknown {
  if (path === null) return toRecord(data);
  const value = dataGet(data, path);
  if (value === MISSING) return {};
  const segments = path.split('.');
  const root: PlainObject = {};
  let cursor = root;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = toRecord(value);
    } else {
      const next: PlainObject = {};
      cursor[segment] = next;
      cursor = next;
    }
  });
  return root;
}

/** Escapes a key for use inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Turns a wildcard attribute into a pattern; `*` matches one segment. */
export function wildcardPattern(attribute: string, star: string): string {
  return attribute.split('*').map(escapeRegExp).join(star);
}

/**
 * `ValidationData::initializeAndGatherData()`, reduced to the ordered keys it
 * yields: every dotted leaf under the attribute's explicit prefix (with
 * wildcard leaves initialised to null), plus every wildcard-prefix key.
 */
export function gatherKeys(attribute: string, data: unknown): string[] {
  let extracted = extractDataFromPath(leadingExplicitPath(attribute), data);
  if (attribute.includes('*') && !attribute.endsWith('*')) {
    extracted = dataSet(extracted, attribute.split('.'), null);
  }
  const keys = arrDot(extracted).map(([key]) => key);
  const prefix = new RegExp(`^${wildcardPattern(attribute, '[^.]*')}`);
  const seen = new Set(keys);
  for (const key of keys) {
    const match = prefix.exec(key);
    if (match && !seen.has(match[0])) {
      seen.add(match[0]);
      keys.push(match[0]);
    }
  }
  return keys;
}

/**
 * Builds `validated()` output the way `Arr::set` fills a PHP array: nested
 * containers are created on demand, and values set earlier are walked into
 * (and kept in place) when a deeper key is set later.
 */
export class PhpArrayBuilder {
  private readonly root = new Map<string, unknown>();

  set(path: string, value: unknown): void {
    const segments = path.split('.');
    let map = this.root;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        map.set(segment, value);
        return;
      }
      let next = map.get(segment);
      if (!(next instanceof Map)) {
        next = isPhpArray(next) ? toMap(next) : new Map<string, unknown>();
        map.set(segment, next);
      }
      map = next as Map<string, unknown>;
    });
  }

  /** PHP `json_encode` shape: keys `0..n-1` in order become a list. */
  toJSON(): unknown {
    return fromMap(this.root);
  }
}

function toMap(value: unknown[] | PlainObject): Map<string, unknown> {
  return new Map<string, unknown>(Object.entries(value));
}

function fromMap(map: Map<string, unknown>): unknown {
  const entries = [...map.entries()].map(
    ([key, value]) =>
      [
        key,
        value instanceof Map ? fromMap(value as Map<string, unknown>) : value,
      ] as const,
  );
  if (entries.every(([key], index) => key === String(index))) {
    return entries.map(([, value]) => value);
  }
  return Object.fromEntries(entries);
}
