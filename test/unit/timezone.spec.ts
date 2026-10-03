describe('test process timezone', () => {
  it('is UTC for the real process, not just the sandbox env', () => {
    expect(new Date(0).getTimezoneOffset()).toBe(0);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});
