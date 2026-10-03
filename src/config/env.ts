import bytes from 'bytes';

export type Env = Record<string, string | undefined>;

/**
 * Reads environment variables and collects every problem instead of stopping
 * at the first one, so a failed boot lists all missing or invalid variables.
 */
export class EnvReader {
  readonly errors: string[] = [];

  constructor(private readonly env: Env) {}

  /** A non-empty value, or an error when missing. */
  required(name: string): string {
    const value = this.raw(name);
    if (value === undefined) {
      this.errors.push(`${name} is required`);
      return '';
    }
    return value;
  }

  optional(name: string): string | undefined;
  optional(name: string, fallback: string): string;
  optional(name: string, fallback?: string): string | undefined {
    return this.raw(name) ?? fallback;
  }

  int(name: string, fallback: number, min = 0): number {
    const value = this.raw(name);
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min) {
      this.errors.push(`${name} must be an integer >= ${min}, got "${value}"`);
      return fallback;
    }
    return Number(value);
  }

  oneOf<T extends string>(
    name: string,
    allowed: readonly T[],
    fallback?: T,
  ): T {
    const value = this.raw(name) ?? fallback;
    if (value === undefined) {
      this.errors.push(`${name} is required (one of: ${allowed.join(', ')})`);
      return allowed[0];
    }
    if (!(allowed as readonly string[]).includes(value)) {
      this.errors.push(
        `${name} must be one of: ${allowed.join(', ')}, got "${value}"`,
      );
      return allowed[0];
    }
    return value as T;
  }

  url(name: string, fallback?: string): string {
    const value =
      fallback === undefined
        ? this.required(name)
        : this.optional(name, fallback);
    if (value !== '' && !URL.canParse(value)) {
      this.errors.push(`${name} must be an absolute URL, got "${value}"`);
    }
    return value;
  }

  /** A size such as `2mb`, returned in bytes. */
  size(name: string, fallback: string): number {
    const value = this.optional(name, fallback);
    const parsed = bytes.parse(value);
    if (parsed === null || Number.isNaN(parsed) || parsed <= 0) {
      this.errors.push(`${name} must be a size such as "2mb", got "${value}"`);
      return bytes.parse(fallback) ?? 0;
    }
    return parsed;
  }

  fail(message: string): void {
    this.errors.push(message);
  }

  private raw(name: string): string | undefined {
    const value = this.env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  }
}

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/** Runs a reader and throws when it recorded any problem. */
export function readOrThrow<T>(env: Env, read: (r: EnvReader) => T): T {
  const reader = new EnvReader(env);
  const value = read(reader);
  if (reader.errors.length > 0) throw new EnvValidationError(reader.errors);
  return value;
}
