import { toLaravelIso } from './timestamps';

describe('toLaravelIso', () => {
  it('formats UTC with six fractional digits', () => {
    expect(toLaravelIso(new Date('2026-01-02T03:04:05Z'))).toBe(
      '2026-01-02T03:04:05.000000Z',
    );
    expect(toLaravelIso(null)).toBeNull();
  });
});
