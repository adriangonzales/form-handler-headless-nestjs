import { withSettingsDefaults } from './form-settings';

describe('withSettingsDefaults', () => {
  it('fills every key, in FormSettings order', () => {
    expect(Object.entries(withSettingsDefaults(null))).toEqual([
      ['redirect', null],
      ['timezone', null],
      ['domains', []],
      ['message', null],
      ['honeypot_enabled', false],
      ['honeypot_name', null],
    ]);
  });

  it('keeps stored values, including explicit nulls, in FormSettings order', () => {
    expect(
      Object.entries(
        withSettingsDefaults({
          honeypot_name: 'hp',
          domains: null,
          redirect: 'https://example.com/thanks',
        }),
      ),
    ).toEqual([
      ['redirect', 'https://example.com/thanks'],
      ['timezone', null],
      ['domains', null],
      ['message', null],
      ['honeypot_enabled', false],
      ['honeypot_name', 'hp'],
    ]);
  });

  it('drops unknown keys and never shares the default domains array', () => {
    const a = withSettingsDefaults({ unknown: 1 } as never);
    expect(a).not.toHaveProperty('unknown');
    a.domains?.push('example.com');
    expect(withSettingsDefaults({}).domains).toEqual([]);
  });
});
