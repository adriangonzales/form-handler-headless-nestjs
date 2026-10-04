/**
 * The parts of PHP's date handling the rules need:
 * - `parseDate()`: absolute dates `strtotime()` + `date_parse()` accept with a
 *   real calendar date (`checkdate`). Relative forms (`now`, `next monday`,
 *   `+1 week`) fail Laravel's `date` rule because `date_parse()` leaves the
 *   date fields empty, so they are not supported here.
 * - `createFromFormat()` / `formatDate()`: `DateTime::createFromFormat('!…')`
 *   and `format()` for the tokens rule formats use.
 */

export interface ParsedDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Minutes east of UTC, or null for "local" (UTC in this app). */
  offset: number | null;
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const MONTH_NAME =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const TIME = '(?:[T\\s]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,]\\d+)?)?)?';
const ZONE = '\\s*(Z|UTC|GMT|[+-]\\d{2}:?\\d{2}|[+-]\\d{1,2})?';

interface Pattern {
  regex: RegExp;
  parts(
    m: RegExpExecArray,
  ): [year: string, month: string, day: string, timeIndex: number];
}

const PATTERNS: Pattern[] = [
  // 2026-01-02, 2026-1-5, with optional time and zone
  {
    regex: new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME}${ZONE}$`, 'i'),
    parts: (m) => [m[1], m[2], m[3], 4],
  },
  // 20260102
  {
    regex: /^(\d{4})(\d{2})(\d{2})()()()()$/,
    parts: (m) => [m[1], m[2], m[3], 4],
  },
  // 2026/01/02
  {
    regex: new RegExp(`^(\\d{4})/(\\d{1,2})/(\\d{1,2})${TIME}${ZONE}$`, 'i'),
    parts: (m) => [m[1], m[2], m[3], 4],
  },
  // American 01/02/2026, 1/2/26
  {
    regex: new RegExp(
      `^(\\d{1,2})/(\\d{1,2})/(\\d{4}|\\d{2})${TIME}${ZONE}$`,
      'i',
    ),
    parts: (m) => [m[3], m[1], m[2], 4],
  },
  // 02-01-2026, 02.01.2026 (day first)
  {
    regex: new RegExp(
      `^(\\d{1,2})[-.](\\d{1,2})[-.](\\d{4})${TIME}${ZONE}$`,
      'i',
    ),
    parts: (m) => [m[3], m[2], m[1], 4],
  },
  // Jan 2 2026, January 2, 2026
  {
    regex: new RegExp(
      `^${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${TIME}${ZONE}$`,
      'i',
    ),
    parts: (m) => [m[3], m[1], m[2], 4],
  },
  // 2 January 2026, 2 Jan, 2026
  {
    regex: new RegExp(
      `^(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME}\\.?,?\\s+(\\d{4})${TIME}${ZONE}$`,
      'i',
    ),
    parts: (m) => [m[3], m[2], m[1], 4],
  },
];

function monthNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  return MONTHS.indexOf(value.slice(0, 3).toLowerCase()) + 1;
}

function yearNumber(value: string): number {
  const year = Number(value);
  if (value.length === 2) return year < 70 ? 2000 + year : 1900 + year;
  return year;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zoneOffset(zone: string | undefined): number | null {
  if (zone === undefined) return null;
  const upper = zone.toUpperCase();
  if (upper === 'Z' || upper === 'UTC' || upper === 'GMT') return 0;
  const m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(zone);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

/** An absolute date with a valid calendar day, or null (Laravel's `date` rule). */
export function parseDate(value: unknown): ParsedDate | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  for (const pattern of PATTERNS) {
    const m = pattern.regex.exec(text);
    if (!m) continue;
    const [y, mo, d, t] = pattern.parts(m);
    const year = yearNumber(y);
    const month = monthNumber(mo);
    const day = Number(d);
    const hour = m[t] ? Number(m[t]) : 0;
    const minute = m[t + 1] ? Number(m[t + 1]) : 0;
    const second = m[t + 2] ? Number(m[t + 2]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
      return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
      offset: zoneOffset(m[t + 3]),
    };
  }
  return null;
}

/** The instant a parsed date names; dates without a zone are UTC (the app's timezone). */
export function toTimestamp(date: ParsedDate): number {
  const local = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    date.hour,
    date.minute,
    date.second,
  );
  return local - (date.offset ?? 0) * 60_000;
}

const TOKEN_PATTERNS: Record<string, string> = {
  Y: '(\\d{1,4})',
  y: '(\\d{2})',
  m: '(\\d{1,2})',
  n: '(\\d{1,2})',
  d: '(\\d{1,2})',
  j: '(\\d{1,2})',
  H: '(\\d{1,2})',
  G: '(\\d{1,2})',
  i: '(\\d{2})',
  s: '(\\d{2})',
};

export class UnsupportedDateFormatError extends Error {}

/**
 * `DateTime::createFromFormat('!' . $format, $value)` in UTC. Out-of-range
 * fields roll over (month 13 → January next year), as PHP does; callers that
 * need an exact match compare `formatDate()` with the input.
 */
export function createFromFormat(format: string, value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const tokens: string[] = [];
  let source = '^';
  for (const ch of format) {
    if (ch in TOKEN_PATTERNS) {
      tokens.push(ch);
      source += TOKEN_PATTERNS[ch];
    } else if (/[a-zA-Z]/.test(ch)) {
      throw new UnsupportedDateFormatError(
        `Unsupported date format character: ${ch}`,
      );
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  const m = new RegExp(`${source}$`).exec(String(value));
  if (!m) return null;
  const f = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  tokens.forEach((token, index) => {
    const n = Number(m[index + 1]);
    if (token === 'Y') f.year = n;
    else if (token === 'y') f.year = n < 70 ? 2000 + n : 1900 + n;
    else if (token === 'm' || token === 'n') f.month = n;
    else if (token === 'd' || token === 'j') f.day = n;
    else if (token === 'H' || token === 'G') f.hour = n;
    else if (token === 'i') f.minute = n;
    else if (token === 's') f.second = n;
  });
  const date = new Date(0);
  date.setUTCFullYear(f.year, f.month - 1, f.day);
  date.setUTCHours(f.hour, f.minute, f.second, 0);
  return date;
}

/** `DateTime::format()` for the same tokens. */
export function formatDate(format: string, date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  let out = '';
  for (const ch of format) {
    switch (ch) {
      case 'Y':
        out += pad(date.getUTCFullYear(), 4);
        break;
      case 'y':
        out += pad(date.getUTCFullYear() % 100);
        break;
      case 'm':
        out += pad(date.getUTCMonth() + 1);
        break;
      case 'n':
        out += String(date.getUTCMonth() + 1);
        break;
      case 'd':
        out += pad(date.getUTCDate());
        break;
      case 'j':
        out += String(date.getUTCDate());
        break;
      case 'H':
        out += pad(date.getUTCHours());
        break;
      case 'G':
        out += String(date.getUTCHours());
        break;
      case 'i':
        out += pad(date.getUTCMinutes());
        break;
      case 's':
        out += pad(date.getUTCSeconds());
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Carbon's lenient parse, as `getDateTime()` uses for comparisons. */
export function parseDateTime(value: unknown): number | null {
  const parsed = parseDate(value);
  return parsed ? toTimestamp(parsed) : null;
}
