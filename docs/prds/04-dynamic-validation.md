# 4. Dynamic Schema Validation

Form submissions are validated against rules stored in each form's `schema`. Those rules are **Laravel validation rule strings** (`"required"`, `"email"`, `"max:255"`). Existing forms already contain them, so the port needs a small interpreter for that rule syntax. Don't translate the rules into `class-validator` decorators: the rules are data, not code.

Both submission endpoints use this: the authenticated `POST /forms/:form/entries` and the public `POST /forms/:form/submissions` (ch. 3 §3.5, §3.6).

The same engine validates **every other request** too. Each Laravel Form Request becomes a rule array (`rules/*.rules.ts`), such as `{ 'schema.*.id': ['required', 'ulid', 'distinct'] }`. This gives one evaluation model, one set of messages, and Laravel's rule order. It's why the port uses no `class-validator` (README, _Technology choices_). Build the engine in plan phase 3, before authentication, because login, password change and reset need `confirmed`, `different`, `current_password`, `unique` and the password rules.

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

The input is the prepared request input from ch. 3 §3.2: the query string merged with the body, strings trimmed and `""` turned into `null`. It arrives from JSON, `application/x-www-form-urlencoded` and `multipart/form-data` bodies. In the last two, every scalar is a string, so `numeric`, `integer` and `boolean` must accept their string forms, as Laravel does. Because `""` is already `null` by the time rules run, `required` fails on it, and `nullable` lets it through as `null`.

Laravel resolves dotted attribute names (`address.city`) into nested input, and `*` wildcards (`tags.*`). The engine supports both, because the request rule arrays need wildcards (`schema.*.id`, `ids.*`, `settings.domains.*`). Wildcard errors use the concrete index as their key (`schema.0.id`).

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

**Copy PHP's behaviour, not its rough JS equivalent.** The obvious JS function disagrees with PHP at the edges:

| Rule                  | Laravel uses                                         | Known differences from the obvious JS choice                                              |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `integer`             | `filter_var(FILTER_VALIDATE_INT)`                     | Accepts `"+5"` and surrounding whitespace; rejects `"015"`, `"1.0"` and `"1e3"`          |
| `numeric`             | `is_numeric`                                         | Accepts `"1e3"`, `" 1"`, `"1 "` and `".5"`; rejects `"0x1A"`, `"1_000"` and `""`         |
| `email`               | `egulias/email-validator` `RFCValidation`            | Accepts `user@localhost`, quoted local parts and IP-literal domains. `isEmail` rejects these unless configured |
| `url`                 | Laravel's own regex plus a list of protocols         | Accepts `http://localhost`; `isURL` needs `require_tld: false`                            |
| `date`                | `strtotime` + `checkdate`                            | Rejects `2026-02-30`, which `Date.parse` accepts by rolling it over. Accepts relative forms such as `next monday` |
| `timezone`            | `DateTimeZone::listIdentifiers(ALL)`, case-sensitive | `Intl.supportedValuesOf('timeZone')` returns `Asia/Calcutta` and leaves out `Asia/Kolkata`. Commit PHP's list as JSON instead |
| `boolean` / `accepted` | strict lists                                        | `"true"` fails `boolean` but passes `accepted`                                            |

Generate the expected results from PHP. Write a small script in the Laravel repo that runs `Validator::make` over a corpus of values for each rule and saves `{rule, value, passes, message}` as JSON. Commit that file under `test/fixtures/` as the source of truth for the table-driven tests. Re-run the script whenever a rule is added.

The fixed endpoints also need these rules, all from the same `validation.php` templates: `missing`, `list`, `array:keys`, `ulid`, `distinct`, `date_format`, `after_or_equal`, `exists`, `unique`, `confirmed`, `different`, `current_password`, `timezone`, `regex`, `size`, `in` (from `Rule::in`), and `password.*` (ch. 5 §5.9). Rules that query the database (`exists`, `unique`, `current_password`) take an injected callback, so the engine itself stays pure.

Find every rule that existing forms actually use before you start:

```sql
SELECT id, schema FROM forms WHERE schema IS NOT NULL AND deleted_at IS NULL;
```

If a production form uses a rule outside this table, add support for it before cut-over.

Result against the dump supplied on 2026-10-03: all 15 forms have an empty schema (`[]`), so no rules are in use. That dump is seed data, and production has no real forms (confirmed 2026-10-03), so there are no existing rules to cover. The minimum set above is the target, and rules that need the file system (`file`, `image`, `mimes`) are out of scope.

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

`validate` is async in practice, because the database-backed rules need queries. The `@Validated(rules)` parameter decorator calls the same method for fixed endpoints. Rules can also be a function of the request, as in `(req) => buildRules(req.form.schema)`. On failure, both paths throw the same `UnprocessableEntityException`, so the body shape is identical (ch. 3 §3.2). Error keys come out in rule-array order and messages in rule order, matching Laravel's `errors` object.

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
- [ ] A table-driven test covers every rule in §4.3 with pass, fail and message, using the PHP-generated corpus.
- [ ] Wildcard rules (`schema.*.id`) report errors under concrete keys (`schema.0.id`).
- [ ] A submitted `"  "` fails `required`; `" Ann "` is stored as `"Ann"`.
- [ ] Submitting to a form using `withBasicSchema` with an empty body returns 422 with three errors and a `message` ending in "(and 2 more errors)". This works on both submission endpoints.
- [ ] A urlencoded public submission with `"1"` for a `boolean` / `numeric` field passes.
- [ ] Saving a form with the rule `"requird"` returns 422 on `schema.0.rules`.
