import { orderedSchema } from './form-field';

describe('orderedSchema', () => {
  it('sorts by order, keeping stored order for ties (stable, like sortBy)', () => {
    const schema = [
      { id: 'C', order: 2 },
      { id: 'A', order: 1 },
      { id: 'D', order: 2 },
      { id: 'B', order: 1 },
    ];
    expect(orderedSchema(schema).map((f) => f.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(schema.map((f) => f.id)).toEqual(['C', 'A', 'D', 'B']); // not mutated
  });

  it('treats a null schema as empty', () => {
    expect(orderedSchema(null)).toEqual([]);
  });
});
