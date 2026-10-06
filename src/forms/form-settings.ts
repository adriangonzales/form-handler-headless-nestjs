/** `App\Data\FormSettings`. */
export interface FormSettings {
  redirect: string | null;
  timezone: string | null;
  domains: string[] | null;
  message: string | null;
  honeypot_enabled: boolean;
  honeypot_name: string | null;
}

export const FORM_SETTINGS_DEFAULTS: Readonly<FormSettings> = Object.freeze({
  redirect: null,
  timezone: null,
  domains: [],
  message: null,
  honeypot_enabled: false,
  honeypot_name: null,
});

/**
 * Stored settings may lack keys (rows written before a setting existed).
 * Fills in every key, in `FormSettings` order, so the API always returns all
 * six (ch. 3 §3.4). Unknown stored keys are dropped, as the Data object does.
 */
export function withSettingsDefaults(
  stored: Partial<FormSettings> | null | undefined,
): FormSettings {
  const settings = { ...FORM_SETTINGS_DEFAULTS, domains: [] } as FormSettings;
  for (const key of Object.keys(
    FORM_SETTINGS_DEFAULTS,
  ) as (keyof FormSettings)[]) {
    if (stored && key in stored && stored[key] !== undefined) {
      (settings as unknown as Record<string, unknown>)[key] = stored[key];
    }
  }
  return settings;
}

/**
 * `parse_url($url, PHP_URL_HOST)`: `null` without an authority, `false` when
 * PHP rejects it. Unlike WHATWG `URL`, it takes the host after the last `@`
 * (so `https://a\@evil.com/` is `evil.com`), splits the port at the last
 * `:`, accepts `//host`, and leaves Unicode hosts as written.
 */
export function phpUrlHost(url: string): string | null | false {
  let rest: string;
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(url);
  if (url.startsWith('//')) rest = url.slice(2);
  else if (scheme && url.startsWith('//', scheme[0].length))
    rest = url.slice(scheme[0].length + 2);
  else return null;

  const end = rest.search(/[/?#]/);
  let host = end === -1 ? rest : rest.slice(0, end);
  host = host.slice(host.lastIndexOf('@') + 1);
  if (!host.endsWith(']')) {
    const colon = host.lastIndexOf(':');
    if (colon >= 0) {
      const port = host.slice(colon + 1);
      if (port !== '' && (!/^\d+$/.test(port) || Number(port) > 65535))
        return false;
      host = host.slice(0, colon);
    }
  }
  return host === '' ? false : host;
}

/**
 * `FormSettings::allowsReferer()`: with domains set, the Referer's host must
 * equal one (case-insensitively), or end with `.example.org` for a
 * `*.example.org` entry. A wildcard doesn't match the bare domain.
 */
export function allowsReferer(
  settings: FormSettings,
  referer: string | null | undefined,
): boolean {
  if (settings.domains === null || settings.domains.length === 0) return true;
  const parsed = phpUrlHost(referer ?? '');
  if (typeof parsed !== 'string' || parsed === '') return false;
  const host = parsed.toLowerCase();
  return settings.domains.some((entry) => {
    const domain = entry.toLowerCase();
    return domain.startsWith('*.')
      ? host.endsWith(domain.slice(1))
      : host === domain;
  });
}

/**
 * `FormSettings::honeypotTripped()`: the honeypot is on and the input has a
 * value under its name. `null`, `""` and empty arrays count as empty.
 */
export function honeypotTripped(
  settings: FormSettings,
  input: Record<string, unknown>,
): boolean {
  if (!settings.honeypot_enabled || settings.honeypot_name === null)
    return false;
  const value = Object.hasOwn(input, settings.honeypot_name)
    ? input[settings.honeypot_name]
    : null;
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}
