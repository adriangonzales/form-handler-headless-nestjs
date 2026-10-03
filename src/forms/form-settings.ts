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
