import { FormEntry } from '../form-entries/form-entry.entity';
import { Form } from './form.entity';
import { mapFormData } from './map-form-data';

function form(schema: Form['schema']): Form {
  return Object.assign(new Form(), { schema });
}

function entry(input: FormEntry['input']): FormEntry {
  return Object.assign(new FormEntry(), { input });
}

describe('mapFormData (MapFormData)', () => {
  it('pairs labels with values in order, keyed by field ID', () => {
    const mapped = mapFormData(
      form([
        { id: 'B', order: 2, label: 'Email', name: 'email' },
        { id: 'A', order: 1, label: 'Name' },
        { id: 'C', order: 3 },
      ]),
      entry({ A: 'Ada', email: 'ada@example.com' }),
    );

    expect(Object.entries(mapped)).toEqual([
      ['A', { label: 'Name', data: 'Ada' }],
      ['B', { label: 'Email', data: 'ada@example.com' }],
      ['C', { label: 'C', data: null }],
    ]);
  });

  it('follows dot paths, preferring a literal dotted key', () => {
    const mapped = mapFormData(
      form([
        { id: 'A', order: 1, name: 'user.email' },
        { id: 'B', order: 2, name: 'address.city' },
      ]),
      entry({ 'user.email': 'flat', address: { city: 'Paris' } }),
    );

    expect(mapped.A.data).toBe('flat');
    expect(mapped.B.data).toBe('Paris');
  });

  it('handles an entry with no input', () => {
    expect(
      mapFormData(form([{ id: 'A', order: 1 }]), entry([])).A.data,
    ).toBeNull();
  });
});
