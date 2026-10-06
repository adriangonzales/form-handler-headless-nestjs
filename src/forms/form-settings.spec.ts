import { withSettingsDefaults, phpUrlHost } from './form-settings';

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

describe('phpUrlHost (parse_url host)', () => {
  // Expected values from PHP 8.4's parse_url($url, PHP_URL_HOST).
  it.each([
    ['https://example.com/contact', 'example.com'],
    ['https://EXAMPLE.com/contact', 'EXAMPLE.com'],
    ['example.com', null],
    ['//example.com/x', 'example.com'],
    ['https://user:pass@example.com:8080/a', 'example.com'],
    ['http://[::1]:80/', '[::1]'],
    ['https://bücher.de/', 'bücher.de'],
    ['http://', false],
    ['http:///example.com', false],
    ['https://example.com.evil.net/', 'example.com.evil.net'],
    ['ftp://Forms.Example.org', 'Forms.Example.org'],
    ['https://exa mple.com/', 'exa mple.com'],
    ['https://example.com?x=1', 'example.com'],
    ['https://example.com#frag', 'example.com'],
    ['javascript:alert(1)', null],
    ['https:example.com', null],
    ['  https://example.com', null],
    ['https://@example.com', 'example.com'],
    ['https://a@b@example.com/', 'example.com'],
    ['https://example.com:abc/', false],
    ['https://example.com:99999/', false],
    ['/relative/path', null],
    ['https://example.com\\@evil.com/', 'evil.com'],
    ['https://example.com/@evil.com', 'example.com'],
    ['mailto:a@example.com', null],
    ['https://ex%41mple.com/', 'ex%41mple.com'],
    ['x://y', 'y'],
    ['https://example.com:/', 'example.com'],
    ['https://:80/', false],
    ['https://user@/x', false],
    ['https://example.com:080/', 'example.com'],
    ['//', false],
    ['///x', false],
    ['https://ex:ample.com:80/', 'ex:ample.com'],
  ])('%s → %p', (url, host) => {
    expect(phpUrlHost(url)).toBe(host);
  });
});
