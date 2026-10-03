# PRD: Forms

**Status:** Built (API only) · **Owner area:** `FormController`, `Form` model, `FormPolicy`, `BuildValidationRules`, `DuplicateForm`, `FormSettings`

## 1. Summary

A Form is the central object of the product. An account holder creates a form, describes its fields and validation rules in a JSON schema, and uses the form's ID as the target for submissions from their own front end. The service never renders the form; it only stores the definition and enforces it when entries arrive.

## 2. Users

- **Account holder / developer** — authenticates with a JWT ([Accounts & Authentication](accounts-and-authentication.md)), creates forms, and wires the form ID into a website or app.

## 3. Goals

- Let a user define a form without deploying backend code.
- Let validation rules live alongside the form definition so submissions are validated server-side.
- Give each form an opaque, non-sequential identifier (ULID) that is safe to embed in public markup.

## 4. Data model

Table `forms`:

| Field                                    | Type            | Notes                                                     |
| ---------------------------------------- | --------------- | --------------------------------------------------------- |
| `id`                                     | ULID (PK)       | Generated automatically                                   |
| `user_id`                                | FK → `users.id` | Owner. Set from the authenticated user on create          |
| `name`                                   | string(400)     | Required                                                  |
| `active`                                 | boolean         | Defaults to `false`                                       |
| `schema`                                 | JSON, nullable  | Field definitions (see §5)                                |
| `settings`                               | JSON, nullable  | Cast to the `App\Data\FormSettings` data object (see §5a) |
| `created_at`, `updated_at`, `deleted_at` | timestamps      | Soft-deletable                                            |

Relationships: belongs to a `User`; has many `FormEntry`; has many `FormNotification`.

## 5. Schema format

`schema` is a JSON **list** of fields. Each item describes one field:

```json
[
    { "id": "01J9...A", "order": 1, "label": "Name", "rules": ["required"] },
    { "id": "01J9...B", "order": 2, "label": "Email", "rules": "required,email" },
    { "id": "01J9...C", "order": 3, "label": "Message", "name": "message" }
]
```

| Key     | Required | Meaning                                                                                                           |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`    | Yes      | The field ID: a ULID, unique within the schema                                                                    |
| `order` | Yes      | Integer used to sort fields for display (entry mapping, alert emails, CSV columns, API responses)                 |
| `label` | No       | Human-readable label. Used when displaying entry data; falls back to the field ID                                 |
| `rules` | No       | Laravel validation rules, either an array of strings or a comma-separated string. Defaults to `["sometimes"]`     |
| `name`  | No       | Overrides the input name used for validation and storage. Defaults to the field ID                                |

- **Structure is validated on save** (`FormStoreRequest`, `FormUpdateRequest`): `schema` must be a list (an object, or a JSON-encoded string, returns 422 on `schema`); each item may only have the keys above (any other key returns 422); `id` is required, must be a ULID and must not repeat (`distinct`); `order` is required and must be an integer; `label` and `name` are nullable strings; each item of an array `rules` must be a string. Rule names themselves are not checked (see §9).
- **Ordering:** fields are stored in the order sent. `Form::orderedSchema()` sorts them by `order` (ties keep their stored order), and everything that displays fields uses it: the API response, `MapFormData` and `WriteEntriesCsv`. `order` values need not be contiguous; validation (FR-5) does not depend on order.
- An empty schema is stored and returned as `[]`; `null` stays `null`.
- The factory's `withBasicSchema()` state builds three fields (Name, Email, Message) with fresh ULIDs and `order` 1–3.

## 5a. Settings format

`settings` is defined by `App\Data\FormSettings` (spatie/laravel-data), which is the single source of truth for both the allowed keys and their validation rules.

```json
{
    "redirect": "https://example.com/thanks",
    "timezone": "America/Chicago",
    "domains": ["example.com", "*.example.org"],
    "message": "Thanks, we will be in touch.",
    "honeypot_enabled": true,
    "honeypot_name": "website"
}
```

| Key                | Type                    | Default | Rules                                                                          | Intended use                                              |
| ------------------ | ----------------------- | ------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `redirect`         | string \| null          | `null`  | URL, max 2048                                                                  | Where to send a browser after a successful submission     |
| `timezone`         | string \| null          | `null`  | Valid PHP timezone identifier                                                  | Submission time in alert emails                           |
| `domains`          | list of strings \| null | `[]`    | List of hostnames; a leading `*.` wildcard is allowed. No scheme, port or path | Origins allowed to submit to the form                     |
| `message`          | string \| null          | `null`  | Max 2000                                                                       | Success message shown to a submitter                      |
| `honeypot_enabled` | boolean                 | `false` | Boolean                                                                        | Flag public submissions that fill in the honeypot as spam |
| `honeypot_name`    | string \| null          | `null`  | Letters, digits, `_` and `-`, max 255; generated when missing (see below)      | Name of the hidden honeypot input                         |

- Unknown keys are rejected with a 422 on `settings`. They are not silently dropped.
- Omitted keys take their defaults. A form with settings always returns all six keys.
- `settings` itself may be `null` or omitted, in which case the form has no settings and the API returns `null`.
- Validation is shared by create and update through `App\Concerns\FormSettingsValidationRules`, which reads the allowed keys and rules from `FormSettings`. Adding a property to `FormSettings` is enough to accept and validate a new setting.
- When a form is created or updated with `honeypot_enabled` true and no `honeypot_name`, a name is filled in before validation: the form's stored name if it has one (so the site's hidden input keeps working), otherwise a generated one. Generated names look like contact fields bots fill in, `website`, `homepage`, `url` or `company`, plus `_` and 6 random lowercase letters and digits (e.g. `website_k3x9qa`), and never match a schema input name. The name is returned in `settings` so the site can add the hidden input. Generated by `App\Actions\Forms\GenerateHoneypotName`.
- `honeypot_name` must not match a schema field's input name (its `name`, or its ID when there is none), or every real submission that fills in that field would be flagged as spam. Create and update reject a clash with 422: on `settings.honeypot_name` when settings are sent, or on `schema` when only the schema is sent and it clashes with the stored honeypot name. Omitted `schema` or `settings` are checked using the form's stored values.
- Planned settings (noted in `FormSettings`): CAPTCHA type (none, reCAPTCHA, hCaptcha) and secret key.

## 6. Functional requirements

**FR-1 List forms.** `GET /api/v1/forms` returns the authenticated user's forms only, paginated (15 per page by default; `per_page` sets 1 to 100, anything else returns 422 on `per_page`) with `links` and `meta`. Pagination links keep all query parameters.

- **Entry counts:** each form in the list also has `entries_count`, `unread_entries_count` and `spam_entries_count`, none of which include deleted entries. `entries_count` counts entries that aren't spam, matching the total of the entry list with `filter[spam]=false`. `unread_entries_count` counts those with no `read_at` (`filter[read]=false&filter[spam]=false`). `spam_entries_count` counts spam entries (`filter[spam]=true`). Other form responses don't include them.

- **Sorting:** the optional `sort` parameter accepts `created_at` (the default), `updated_at` or `name`. Prefix it with `-` for descending order, e.g. `sort=-updated_at`. Names are compared case-insensitively. Ties are broken by ID in the same direction. Any other value, including combined sorts such as `name,-created_at`, returns 422 on `sort`.
- **Filtering:** `filter[active]=true` or `filter[active]=false` (`1` and `0` also work) limits the list to active or inactive forms. Any other value returns 422 on `filter.active`, and any other filter key returns 422 on `filter`. Filtering and sorting can be combined.

**FR-2 Show a form.** `GET /api/v1/forms/{form}` returns `{ data: { id, user_id, name, active, schema, settings, created_at, updated_at, deleted_at } }`, with `schema`'s fields sorted by `order`. `created_at`, `updated_at` and `deleted_at` are ISO 8601 UTC strings with microseconds (e.g. `2026-01-02T03:04:05.000000Z`); `deleted_at` is `null` for any record the API can return. Only the owner may view a form; anyone else receives `403 {"message":"You do not own this form."}` (`FormPolicy::view`).

**FR-3 Create a form.** `POST /api/v1/forms` accepts:

| Field      | Rules                                                        |
| ---------- | ------------------------------------------------------------ |
| `name`     | required, string, max 400                                    |
| `schema`   | nullable, list of fields matching §5                         |
| `settings` | nullable, object matching §5a                                |

The form is created under the authenticated user, `active` defaults to `false`, a `FormCreated` event is dispatched, and the response is `201` with the form resource.

**FR-4 Update a form.** `PUT/PATCH /api/v1/forms/{form}` accepts `name` (required, string, max 400), `active` (required, boolean), `schema` (nullable, list of fields matching §5), `settings` (nullable, object matching §5a). Because `name` and `active` are required, a PATCH is effectively a full replacement of those two fields. Only the owner may update a form (`FormPolicy::update`, checked in `FormUpdateRequest` before validation); anyone else receives the same 403.

**FR-5 Schema → validation rules.** `BuildValidationRules` converts the schema into a Laravel rules array keyed by each field's `name ?? id`. String rules are split on commas. Fields without rules get `sometimes`. An empty or null schema produces no rules.

**FR-6 Inactive forms reject submissions.** Entries can only be submitted to forms with `active = true` (`FormPolicy::submit`). Submissions to an inactive form receive `403 {"message":"This form is not accepting submissions."}` before any validation runs, and no entry is stored.

**FR-7 Entry display mapping.** `MapFormData` pairs each schema field, sorted by `order`, with an entry's value, producing `{ fieldId: { label, data } }`. Values are looked up under the field's `name` when it has one, otherwise its `id`, matching how submissions are stored. It builds the field list in new-entry alert emails ([Form Notifications](form-notifications.md)).

**FR-8 Delete a form.** `DELETE /api/v1/forms/{form}` soft-deletes the form and returns `204`. Its entries and notifications are left untouched. A deleted form returns 404 from every other form endpoint (including submissions) until it is restored. Owner only (`FormPolicy::delete`). There is no permanent delete (`FormPolicy::forceDelete` denies).

**FR-9 Restore a form.** `POST /api/v1/forms/{form}/restore` clears `deleted_at` and returns `200` with the form resource. The route resolves soft-deleted forms. Owner only (`FormPolicy::restore`).

**FR-10 Duplicate a form.** `POST /api/v1/forms/{form}/duplicate` creates a new form owned by the same user, with the same `schema` and `settings`, the name suffixed with ` (copy)` (the original is truncated if needed to stay within 400 characters), and `active = false`. Entries and notification recipients are not copied. The copy is made by the `App\Actions\Forms\DuplicateForm` action, which dispatches `FormCreated`. Returns `201` with the new form. Owner only (`FormPolicy::view`).

## 7. Events

- `FormCreated(Form $form)` — dispatched after create and after duplicate. No listeners are registered.

## 8. Gaps

None currently tracked.

## 9. Known issues

- **Unvalidated rule strings.** Rules from the schema are passed straight to the validator. An invalid rule name causes a server error at submission time rather than a 422 at form-save time.

## 10. Open questions

1. Should field definitions support type, placeholder and options, or stay validation-only? (Ordering was added with `order`.)
2. Should rule names be checked when a form is saved? (The schema's structure is now validated, see §5.)
