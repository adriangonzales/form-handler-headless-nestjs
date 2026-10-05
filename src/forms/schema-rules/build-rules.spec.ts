import { ulid } from 'ulid';
import { buildRules } from './build-rules';
import type { FormField } from '../form-field';

/** Port of `tests/Feature/Actions/BuildValidationRulesTest.php` (3). */
describe('BuildValidationRulesTest', () => {
  it('produces no validation rules from an empty schema', () => {
    expect(buildRules([])).toEqual({});
  });

  it('produces validation rules from a basic schema', () => {
    const schema: FormField[] = [
      { id: ulid(), order: 1, label: 'Name', rules: ['required'] },
      { id: ulid(), order: 2, label: 'Email', rules: ['required', 'email'] },
      { id: ulid(), order: 3, label: 'Message', rules: ['required'] },
    ];

    expect(buildRules(schema)).toStrictEqual({
      [schema[0].id]: ['required'],
      [schema[1].id]: ['required', 'email'],
      [schema[2].id]: ['required'],
    });
  });

  it('produces validation rules from a comma delimited schema', () => {
    const schema: FormField[] = [
      { id: ulid(), order: 1, label: 'Name', rules: 'required' },
      { id: ulid(), order: 2, label: 'Email', rules: 'required,email' },
      { id: ulid(), order: 3, label: 'Message', rules: 'required' },
    ];

    expect(buildRules(schema)).toStrictEqual({
      [schema[0].id]: ['required'],
      [schema[1].id]: ['required', 'email'],
      [schema[2].id]: ['required'],
    });
  });
});

describe('buildRules details (ch. 4 §4.1)', () => {
  it('defaults to sometimes, keys by name, and lets a later field win', () => {
    expect(
      buildRules([
        { id: '01K6E2E0000000000000000001', order: 2, name: 'email' },
        { id: '01K6E2E0000000000000000002', order: 1, rules: null },
        {
          id: '01K6E2E0000000000000000003',
          order: 3,
          name: 'email',
          rules: ['required'],
        },
      ] as FormField[]),
    ).toStrictEqual({
      email: ['required'],
      '01K6E2E0000000000000000002': ['sometimes'],
    });
  });

  it('splits a string on commas, breaking in:a,b apart', () => {
    expect(
      buildRules([{ id: 'x', order: 1, rules: 'required,in:a,b' }]),
    ).toStrictEqual({ x: ['required', 'in:a', 'b'] });
  });

  it('gives no rules for a null schema', () => {
    expect(buildRules(null)).toEqual({});
  });
});
