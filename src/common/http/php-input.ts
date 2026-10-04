/**
 * PHP's request-variable parsing (`php_register_variable_ex`), used by
 * `parse_str()`, query strings, urlencoded bodies and multipart fields:
 * - top-level names have spaces and dots turned into `_` (`first name` →
 *   `first_name`, `user.email` → `user_email`), leading spaces dropped;
 * - `a[b][c]` nests, `a[]` appends, `a[1]` is an assoc key (not a dense list);
 * - an unmatched `[` becomes `_`; text after a `]` that isn't `[` is ignored.
 *
 * Results use PHP's array shape: keys `0..n-1` in order become a list.
 */

/** A PHP array: ordered keys, integer-like keys tracked for `[]` appends. */
class PhpArray {
  readonly entries = new Map<string, unknown>();
  private nextIndex = 0;

  set(key: string | null, value: unknown): string {
    const resolved = key ?? String(this.nextIndex);
    if (/^(0|-?[1-9]\d*)$/.test(resolved)) {
      this.nextIndex = Math.max(this.nextIndex, Number(resolved) + 1);
    }
    this.entries.set(resolved, value);
    return resolved;
  }

  toValue(): unknown {
    const entries = [...this.entries.entries()].map(
      ([key, value]) =>
        [key, value instanceof PhpArray ? value.toValue() : value] as const,
    );
    if (entries.every(([key], index) => key === String(index))) {
      return entries.map(([, value]) => value);
    }
    return Object.fromEntries(entries);
  }
}

/** Collects variables in the order they arrive, as PHP builds `$_GET`/`$_POST`. */
export class PhpVariables {
  private readonly root = new PhpArray();

  register(name: string, value: string): void {
    const variable = name.replace(/^ +/, '');
    let base = '';
    let i = 0;
    for (; i < variable.length; i++) {
      const ch = variable[i];
      if (ch === ' ' || ch === '.') base += '_';
      else if (ch === '[') break;
      else base += ch;
    }
    if (base === '') return;
    if (i === variable.length) {
      this.root.set(base, value);
      return;
    }

    const indices: (string | null)[] = [];
    let ip = i;
    while (ip < variable.length && variable[ip] === '[') {
      const close = variable.indexOf(']', ip + 1);
      if (close < 0) {
        if (indices.length === 0) {
          this.root.set(`${base}_${variable.slice(ip + 1)}`, value);
          return;
        }
        break;
      }
      const index = variable.slice(ip + 1, close);
      indices.push(index === '' ? null : index);
      ip = close + 1;
    }

    let container = this.root;
    let key: string | null = base;
    for (const index of indices) {
      const existing = key === null ? undefined : container.entries.get(key);
      let next: PhpArray;
      if (existing instanceof PhpArray) {
        next = existing;
      } else {
        next = new PhpArray();
        key = container.set(key, next);
      }
      container = next;
      key = index;
    }
    container.set(key, value);
  }

  toValue(): Record<string, unknown> | unknown[] {
    return this.root.toValue() as Record<string, unknown> | unknown[];
  }
}

/** `urldecode()`: `+` is a space; invalid `%` escapes are kept as-is. */
export function urldecode(value: string): string {
  const bytes: number[] = [];
  const text = value.replace(/\+/g, ' ');
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(text[i], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** `parse_str()` for a query string or urlencoded body. */
export function parsePhpQuery(
  query: string,
): Record<string, unknown> | unknown[] {
  const vars = new PhpVariables();
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const name = urldecode(eq < 0 ? pair : pair.slice(0, eq));
    const value = urldecode(eq < 0 ? '' : pair.slice(eq + 1));
    vars.register(name, value);
  }
  return vars.toValue();
}

/** Number of variables in a query string, for PHP's `max_input_vars`. */
export function countPhpVariables(query: string): number {
  return query.split('&').filter((pair) => pair !== '').length;
}
