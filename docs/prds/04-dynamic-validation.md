# 4. Dynamic Schema Validation

Form submissions are validated against rules stored in each form's `schema`. Those rules are **Laravel validation rule strings** (`"required"`, `"email"`, `"max:255"`). Existing forms already contain them, so the port needs a small interpreter for that rule syntax. Don't translate the rules into `class-validator` decorators: the rules are data, not code.

Both submission endpoints use this: the authenticated `POST /forms/:form/entries` and the public `POST /forms/:form/submissions` (ch. 3 §3.5, §3.6).

## 4.1 Building the rule set (port of `BuildValidationRules`)

```ts
export function buildRules(schema: FormField[] | null): Record<string, string[]> {
    const rules: Record<string, string[]> = {};
    for (const field of schema ?? []) {
        let fieldRules = field.rules ?? ['sometimes'];
        if (typeof fieldRules === 'string') fieldRules = fieldRules.split(',');
        rules[field.name ?? field.id] = fieldRules;
    }
    return rules;
}
```

Port these behaviours exactly:

- Iterate the schema in **stored** order, not sorted by `order`. That only matters when two fields share an input name: the later one wins.
- No `rules` (or `null`) means `['sometimes']`.
- A string is split on **commas**. `"required,email"` becomes `['required', 'email']`. This means `"in:a,b"` as a _string_ breaks into `in:a` and `b`. That's existing behaviour: keep it, and reject the stray `b` as an unknown rule on save (§4.5). Array-form rules such as `["in:a,b"]` work correctly.
- The key is `field.name`, falling back to `field.id`. An empty or `null` schema gives no rules.

Port the three `BuildValidationRulesTest` cases verbatim (ch. 7).

## 4.2 Evaluation model

For each `[attribute, rules]`:

1. If `sometimes` is present and the key is **absent** from the body, skip the attribute entirely. It won't appear in the validated output.
2. If `nullable` is present and the value is `null`, skip the remaining rules, but still include the key in the output.
3. `required` fails when the value is missing, `null`, a whitespace-only string, or an empty array or object.
4. When the value is absent and there's no `required` (or `required_*`), skip the other rules. Laravel treats rules on missing, non-implicit attributes this way.
5. Evaluate the rules in order and collect every failure message. Laravel doesn't stop at the first failure unless `bail` is present.

The **validated output** contains only attributes that have rules and are present in the input, with their original values. It becomes `entry.input`.

Input arrives from JSON bodies and from `application/x-www-form-urlencoded` bodies (public submissions). In the second case every scalar is a string, so `numeric`, `integer` and `boolean` must accept their string forms, as Laravel does.

Laravel resolves dotted attribute names (`address.city`) into nested input, and `*` wildcards (`tags.*`). Support dotted names. Check production schemas for wildcards (§4.3) before deciding whether to support them.

## 4.3 Supported rules (minimum set)

Support this set in the port. Its messages come from Laravel's `en/validation.php`.

| Rule          | Passes when                                             | Message                                             |
| ------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `required`    | see §4.2                                                | The :attribute field is required.                   |
| `sometimes`   | modifier                                                | –                                                   |
| `nullable`    | modifier                                                | –                                                   |
| `bail`        | modifier: stop at the first failure for this attribute  | –                                                   |
| `string`      | `typeof v === 'string'`                                 | The :attribute field must be a string.              |
| `integer`     | integer number or integer-like string                   | The :attribute field must be an integer.            |
| `numeric`     | number, or a numeric string                             | The :attribute field must be a number.              |
| `boolean`     | `true false 1 0 "1" "0"`                                | The :attribute field must be true or false.         |
| `accepted`    | `yes on 1 "1" true "true"`                              | The :attribute field must be accepted.              |
| `array`       | array or object                                         | The :attribute field must be an array.              |
| `email`       | RFC-ish email (use the `validator` package's `isEmail`) | The :attribute field must be a valid email address. |
| `url`         | `isURL` with a protocol required                        | The :attribute field must be a valid URL.           |
| `date`        | parseable by `Date`                                     | The :attribute field must be a valid date.          |
| `in:a,b`      | value is in the list                                    | The selected :attribute is invalid.                 |
| `min:n`       | size ≥ n                                                | depends on type, see below                          |
| `max:n`       | size ≤ n                                                | depends on type, see below                          |
| `between:a,b` | a ≤ size ≤ b                                            | depends on type                                     |
| `regex:/…/`   | pattern matches                                         | The :attribute field format is invalid.             |

**Size** depends on type, as in Laravel. If the attribute also has `numeric` or `integer`, size is the numeric value. For arrays it's the element count. Otherwise it's the string length in characters. Messages:

- `min.string`: "The :attribute field must be at least :min characters."
- `min.numeric`: "The :attribute field must be at least :min."
- `min.array`: "The :attribute field must have at least :min items."
- `max.*`: the same pattern, using "must not be greater than :max" / "must not have more than :max items".
- `between.*`: "must be between :min and :max" (+ " characters" / "items").

Replace `:attribute` with the attribute key, with underscores turned into spaces. Existing forms mostly use ULID keys or explicit `name`s, so tests should assert on error **keys**. Exact message text is only contractual for simple snake_case names.

Find every rule that existing forms actually use before you start:

```sql
SELECT id, schema FROM forms WHERE schema IS NOT NULL AND deleted_at IS NULL;
```

If a production form uses a rule outside this table, add support for it before cut-over.

## 4.4 Interface

```ts
@Injectable()
export class SchemaValidator {
    validate(
        rules: Record<string, string[]>,
        input: Record<string, unknown>,
    ):
        | { ok: true; validated: Record<string, unknown> }
        | { ok: false; errors: Record<string, string[]> };

    unsupportedRules(rules: Record<string, string[]>): string[]; // for §4.5
}
```

On failure, the controller throws the same `UnprocessableEntityException` the DTO pipe uses, so the body shape is identical (ch. 3 §3.2).

## 4.5 Rule names checked on save (F7)

This is the one intentional difference from Laravel. Laravel validates the schema's **structure** on save (ch. 3 §3.4) but not the rule **names**, so a typo only shows up as a 500 when someone submits the form. In the port, extend the form create and update validation:

- For each schema item, run its `rules` through `buildRules` and check every rule name (the part before `:`) against the supported set.
- Report a bad rule under `schema.N.rules`, with 422. Message: "The schema.N.rules field contains an unsupported rule: foo."
- Run this after the structural rules, and only for items that passed them.

Laravel would accept such a form, so the contract suite marks this case as F7 (ch. 7 §7.4).

## 4.6 Display mapping (port of `MapFormData`)

Alert emails use this (ch. 6 §6.5):

```ts
export function mapFormData(form: Form, entry: FormEntry) {
    const out: Record<string, { label: string; data: unknown }> = {};
    for (const field of form.orderedSchema()) {
        out[field.id] = {
            label: field.label ?? field.id,
            data: get(entry.input ?? {}, field.name ?? field.id) ?? null,
        };
    }
    return out;
}
```

- Fields are in `order` order, keyed by field ID.
- Values are looked up under the field's input name (`name ?? id`), matching how submissions are stored.
- `get` supports dot paths, like `Arr::get`.

## Done when

- [ ] All `BuildValidationRulesTest` cases pass.
- [ ] A table-driven test covers every rule in §4.3 with pass, fail and message.
- [ ] Submitting to a form using `withBasicSchema` with an empty body returns 422 with three errors and a `message` ending in "(and 2 more errors)". This works on both submission endpoints.
- [ ] A urlencoded public submission with `"1"` for a `boolean` / `numeric` field passes.
- [ ] Saving a form with the rule `"requird"` returns 422 on `schema.0.rules`.
