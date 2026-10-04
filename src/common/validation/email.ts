/**
 * Laravel's default `email` rule: egulias `RFCValidation`. This is a compact
 * RFC 5322 parser covering what that validator accepts and rejects for real
 * addresses; the PHP-generated corpus pins the cases.
 *
 * Accepted: dot-atom or quoted local parts (UTF-8 allowed, no length limit,
 * as egulias only warns), domain names with any number of labels (including
 * `localhost`), and `[IPv4]` / `[IPv6:…]` literals.
 * Rejected: CR/LF, empty parts, leading/trailing/consecutive dots, `_` or a
 * leading/trailing `-` in a domain label, spaces outside quotes.
 */

// RFC 5322 atext, plus any non-ASCII character (RFC 6532).
const ATEXT = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~\u0080-\u{10FFFF}]+$/u;
const LABEL =
  /^[A-Za-z0-9\u0080-\u{10FFFF}](?:[A-Za-z0-9\-\u0080-\u{10FFFF}]*[A-Za-z0-9\u0080-\u{10FFFF}])?$/u;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^IPv6:[0-9A-Fa-f:.]+$/;

export function isEmail(value: unknown): boolean {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return false;

  let local: string;
  let rest: string;
  if (value.startsWith('"')) {
    const end = closingQuote(value);
    if (end < 0) return false;
    local = value.slice(0, end + 1);
    rest = value.slice(end + 1);
    if (!rest.startsWith('@')) return false;
    rest = rest.slice(1);
  } else {
    const at = value.lastIndexOf('@');
    if (at < 0) return false;
    local = value.slice(0, at);
    rest = value.slice(at + 1);
    if (!isDotAtom(local)) return false;
  }
  return isDomain(rest);
}

/** Index of the quote that closes a quoted local part, honouring `\` escapes. */
function closingQuote(value: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '\\') i++;
    else if (value[i] === '"') return i;
  }
  return -1;
}

function isDotAtom(local: string): boolean {
  return local !== '' && local.split('.').every((atom) => ATEXT.test(atom));
}

function isDomain(domain: string): boolean {
  if (domain === '') return false;
  if (domain.startsWith('[')) {
    if (!domain.endsWith(']')) return false;
    const literal = domain.slice(1, -1);
    return IPV4.test(literal) || IPV6.test(literal);
  }
  return domain.split('.').every((label) => LABEL.test(label));
}
