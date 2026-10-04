/**
 * Implementations of the string rules, ports of Laravel's
 * `ValidatesAttributes::validate{Rule}()`. Keys are lowercased Studly names
 * (PHP method names are case-insensitive).
 */
import { isUlid } from '../db/ulid';
import timezones from './reference/timezones.json';
import {
  dataGet,
  dataHas,
  MISSING,
  arrDot,
  extractDataFromPath,
  leadingExplicitPath,
  wildcardPattern,
} from './data';
import { createFromFormat, formatDate, parseDate, parseDateTime } from './date';
import { isEmail } from './email';
import {
  isFilterInt,
  isList,
  isNumeric,
  isPhpArray,
  looseEquals,
  mbStrlen,
  phpCount,
  phpString,
  phpTrim,
  toNumber,
} from './php';
import { isUrl } from './url';

export interface RuleContext {
  attribute: string;
  value: unknown;
  params: string[];
  data: unknown;
  hasRule(names: string[]): boolean;
  /** The wildcard attribute this one was expanded from, or itself. */
  primaryAttribute: string;
  /** Rule parameters of another rule on this attribute (e.g. `DateFormat`). */
  ruleParams(name: string): string[] | null;
  ruleParamsFor(attribute: string, name: string): string[] | null;
}

export const NUMERIC_RULES = ['Numeric', 'Integer', 'Decimal'];
export const IMPLICIT_RULES = ['Accepted', 'Missing', 'Present', 'Required'];
export const SIZE_RULES = ['Size', 'Between', 'Min', 'Max'];
export const DEPENDENT_RULES = [
  'AfterOrEqual',
  'Confirmed',
  'Different',
  'Unique',
];

const TIMEZONES = new Set(timezones);

type RuleImpl = (ctx: RuleContext) => boolean;

/** `validateRequired()`: PHP's ASCII `trim`, empty arrays fail. */
export function requiredPasses(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && phpTrim(value) === '') return false;
  if (isPhpArray(value) && phpCount(value) < 1) return false;
  return true;
}

/** `getSize()`: numeric value, element count, or string length. */
function size(ctx: RuleContext): number {
  const { value } = ctx;
  if (isNumeric(value) && ctx.hasRule(NUMERIC_RULES)) return toNumber(value);
  if (isPhpArray(value)) return phpCount(value);
  return mbStrlen(phpString(value));
}

function bound(param: string | undefined): number | null {
  if (param === undefined) return null;
  const trimmed = param.trim();
  return isNumeric(trimmed) ? Number(trimmed) : null;
}

function compareSize(
  ctx: RuleContext,
  test: (size: number, a: number, b: number) => boolean,
): boolean {
  const a = bound(ctx.params[0]);
  const b = bound(ctx.params[1]);
  if (a === null || (ctx.params.length > 1 && b === null)) return false;
  return test(size(ctx), a, b ?? a);
}

/** PHP regex literal (`/…/flags`, any delimiter) → RegExp. */
export function phpRegex(literal: string): RegExp | null {
  const delimiter = literal[0];
  const closing =
    { '(': ')', '{': '}', '[': ']', '<': '>' }[delimiter] ?? delimiter;
  const end = literal.lastIndexOf(closing);
  if (end <= 0) return null;
  let body = literal.slice(1, end);
  const modifiers = literal.slice(end + 1);
  let flags = '';
  for (const m of modifiers) {
    if (m === 'i' || m === 'm' || m === 's') flags += m;
    else if (m === 'u') flags += 'u';
    else if (m === 'x')
      body = body
        .replace(/\\#/g, '\uE000')
        .replace(/#.*$/gm, '')
        .replace(/\s+/g, '')
        .replace(/\uE000/g, '\\#');
    else if (m === 'D') continue;
    else return null;
  }
  body = body.replace(/\\A/g, '^').replace(/\\[zZ]/g, '$');
  try {
    return new RegExp(body, flags);
  } catch {
    return null;
  }
}

/** `extractDistinctValues()`: every other value under the same wildcard. */
function distinctValues(ctx: RuleContext): [string, unknown][] {
  const primary = ctx.primaryAttribute;
  const subtree = extractDataFromPath(leadingExplicitPath(primary), ctx.data);
  const pattern = new RegExp(`^${wildcardPattern(primary, '[^.]+')}$`, 'u');
  return arrDot(subtree).filter(([key]) => pattern.test(key));
}

/** `compareDates()` for `after_or_equal` (and friends), with `date_format` support. */
function compareDates(
  ctx: RuleContext,
  test: (a: number, b: number) => boolean,
): boolean {
  const { value, params } = ctx;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const format = ctx.ruleParams('DateFormat')?.[0];
  if (format !== undefined) {
    const first = withOptionalFormat(format, value);
    const otherFormat =
      ctx.ruleParamsFor(params[0], 'DateFormat')?.[0] ?? format;
    let second = withOptionalFormat(otherFormat, params[0]);
    if (second === null) {
      const other = dataGet(ctx.data, params[0]);
      if (other === MISSING || other === null) return true;
      second = withOptionalFormat(otherFormat, other);
    }
    return first !== null && second !== null && test(first, second);
  }
  let other = parseDateTime(params[0]);
  if (other === null) {
    const otherValue = dataGet(ctx.data, params[0]);
    other =
      otherValue === MISSING || otherValue === null
        ? null
        : parseDateTime(otherValue);
  }
  const mine = parseDateTime(value);
  return mine !== null && other !== null && test(mine, other);
}

function withOptionalFormat(format: string, value: unknown): number | null {
  return createFromFormat(format, value)?.getTime() ?? parseDateTime(value);
}

export const RULES: Record<string, RuleImpl> = {
  // Modifiers: always pass; the engine reads them.
  sometimes: () => true,
  nullable: () => true,
  bail: () => true,

  required: ({ value }) => requiredPasses(value),
  present: ({ data, attribute }) => dataHas(data, attribute),
  missing: ({ data, attribute }) => !dataHas(data, attribute),
  accepted: ({ value }) =>
    requiredPasses(value) &&
    ['yes', 'on', '1', 1, true, 'true'].includes(value as never),

  string: ({ value }) => typeof value === 'string',
  integer: ({ value }) => isFilterInt(value),
  numeric: ({ value }) => isNumeric(value),
  boolean: ({ value }) =>
    [true, false, 0, 1, '0', '1'].includes(value as never),

  array: ({ value, params }) => {
    if (!isPhpArray(value)) return false;
    return (
      params.length === 0 ||
      Object.keys(value).every((key) => params.includes(key))
    );
  },
  list: ({ value }) => isPhpArray(value) && isList(value),

  in: (ctx) => {
    const { value, params } = ctx;
    if (isPhpArray(value) && ctx.hasRule(['Array'])) {
      const items = Object.values(value);
      return (
        items.every((item) => !isPhpArray(item)) &&
        items.every((item) => params.includes(phpString(item)))
      );
    }
    return !isPhpArray(value) && params.includes(phpString(value));
  },

  distinct: (ctx) => {
    const others = distinctValues(ctx)
      .filter(([key]) => key !== ctx.attribute)
      .map(([, value]) => value);
    if (ctx.params.includes('ignore_case') && typeof ctx.value === 'string') {
      const lower = ctx.value.toLowerCase();
      return !others.some(
        (o) => typeof o === 'string' && o.toLowerCase() === lower,
      );
    }
    const strict = ctx.params.includes('strict');
    return !others.some((o) =>
      strict ? o === ctx.value : looseEquals(o, ctx.value),
    );
  },

  min: (ctx) => compareSize(ctx, (s, a) => s >= a),
  max: (ctx) => compareSize(ctx, (s, a) => s <= a),
  between: (ctx) => compareSize(ctx, (s, a, b) => s >= a && s <= b),
  size: (ctx) => compareSize(ctx, (s, a) => s === a),

  regex: ({ value, params }) => {
    if (typeof value !== 'string' && !isNumeric(value)) return false;
    const pattern = phpRegex(params[0] ?? '');
    if (pattern === null) throw new Error(`Invalid regex rule: ${params[0]}`);
    return pattern.test(phpString(value));
  },

  email: ({ value }) => isEmail(value),
  url: ({ value }) => isUrl(value),
  ulid: ({ value }) => isUlid(value),
  timezone: ({ value, params }) => {
    const group = (params[0] ?? 'all').toLowerCase();
    if (group !== 'all')
      throw new Error(`Unsupported timezone group: ${params[0]}`);
    return typeof value === 'string' && TIMEZONES.has(value);
  },

  date: ({ value }) => parseDate(value) !== null,
  dateformat: ({ value, params }) => {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    return params.some((format) => {
      const date = createFromFormat(format, value);
      return date !== null && formatDate(format, date) === String(value);
    });
  },
  afterorequal: (ctx) => compareDates(ctx, (a, b) => a >= b),

  confirmed: ({ value, params, attribute, data }) => {
    const other = dataGet(data, params[0] ?? `${attribute}_confirmation`);
    return value === (other === MISSING ? null : other);
  },
  different: ({ value, params, data }) =>
    params.every((param) => {
      const other = dataGet(data, param);
      return other === MISSING || value !== other;
    }),
};

/** Snake-case names of the string rules the engine supports (for F7, ch. 4 §4.5). */
export const SUPPORTED_RULE_NAMES = [
  'sometimes',
  'nullable',
  'bail',
  'required',
  'present',
  'missing',
  'accepted',
  'string',
  'integer',
  'numeric',
  'boolean',
  'array',
  'list',
  'in',
  'distinct',
  'min',
  'max',
  'between',
  'size',
  'regex',
  'email',
  'url',
  'ulid',
  'timezone',
  'date',
  'date_format',
  'after_or_equal',
  'confirmed',
  'different',
] as const;
