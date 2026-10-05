import messagesJson from './reference/messages.json';

/**
 * Laravel's English `validation.*` templates, exported from the reference app
 * by `test/fixtures/laravel/scripts/export-reference.php`.
 */
type Template = string | Record<string, string>;
const TEMPLATES = messagesJson as Record<string, Template>;

export type SizeType = 'numeric' | 'array' | 'string';

/** `validation.{rule}` (or `validation.{rule}.{type}` for size rules). */
export function template(snakeRule: string, sizeType?: SizeType): string {
  const entry = TEMPLATES[snakeRule];
  if (typeof entry === 'string') return entry;
  if (entry && sizeType && typeof entry[sizeType] === 'string')
    return entry[sizeType];
  return `validation.${snakeRule}`;
}

/** A nested key such as `validation.password.mixed`. */
export function nestedTemplate(rule: string, key: string): string {
  const entry = TEMPLATES[rule];
  return typeof entry === 'object' && typeof entry[key] === 'string'
    ? entry[key]
    : `validation.${rule}.${key}`;
}

/** `ValidationException::summarize()`: the first message plus "(and N more error[s])". */
export function summarize(messages: string[]): string {
  if (messages.length === 0) return 'The given data was invalid.';
  const [first, ...rest] = messages;
  if (rest.length === 0) return first;
  return `${first} (and ${rest.length} more ${rest.length === 1 ? 'error' : 'errors'})`;
}

/** `:attribute`, `:ATTRIBUTE` and `:Attribute`. */
export function replaceAttribute(message: string, display: string): string {
  return message
    .replaceAll(':attribute', display)
    .replaceAll(':ATTRIBUTE', display.toUpperCase())
    .replaceAll(
      ':Attribute',
      display.charAt(0).toUpperCase() + display.slice(1),
    );
}
