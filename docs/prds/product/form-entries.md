# PRD: Form Entries

**Status:** Partially built · **Owner area:** `FormEntryController`, `FormSubmissionController`, `FormEntry` model, `FormEntryStoreRequest`, `FormSubmissionRequest`, `CreateFormEntry`

## 1. Summary

A Form Entry is one submission to a form. The service validates submitted fields against the form's schema, stores only the validated values, records request metadata (IP, user agent, referer), and exposes entries to the form owner for review and triage (starring, marking read, spam flags).

## 2. Users

- **Submitter** — an end user filling in a form on a third-party site. They submit to the public endpoint (FR-1a) without any credentials.
- **Account holder** — reviews and triages entries for their forms.

## 3. Goals

- Accept structured submissions and reject invalid ones with field-level errors.
- Keep an audit trail of where each submission came from.
- Provide an inbox-style workflow: unread/read, starred, spam.

## 4. Data model

Table `form_entries`:

| Field                                    | Type                   | Notes                                         |
| ---------------------------------------- | ---------------------- | --------------------------------------------- |
| `id`                                     | ULID (PK)              |                                               |
| `form_id`                                | FK (ULID) → `forms.id` |                                               |
| `input`                                  | JSON, nullable         | Validated submission values                   |
| `ip`                                     | string, nullable       | All client IPs from the request, comma-joined |
| `ip_location_display`                    | string, nullable       | Reserved; not populated                       |
| `referer`                                | string, nullable       | `Referer` header, truncated to 255 characters |
| `user_agent`                             | string, nullable       | Raw UA string                                 |
| `user_agent_display`                     | JSON, nullable         | Parsed user agent (see FR-1a)                 |
| `spam`                                   | boolean, nullable      | Model default `false`                         |
| `spam_score`                             | decimal(3,2)           | Default `0`. Rounded to 2 decimals when set   |
| `spam_reason`                            | string, nullable       |                                               |
| `spam_checked_at`                        | timestamp, nullable    | When the spam check finished (see FR-1, FR-1a) |
| `starred`                                | boolean                | Default `false`                               |
| `read_at`                                | timestamp, nullable    | `null` = unread                               |
| `created_at`, `updated_at`, `deleted_at` | timestamps             | Soft-deletable                                |

## 5. Functional requirements

**FR-1 Submit an entry.** `POST /api/v1/forms/{form}/entries` (JWT-authenticated).

- Only the form's owner may submit through this endpoint; anyone else receives `403 {"message":"You do not own this form."}`.
- The form must be active; otherwise the request is rejected with `403 {"message":"This form is not accepting submissions."}`. Both checks run before validation.
- Request fields are validated with the rules built from the form's schema (see [Forms FR-5](forms.md)). Failures return 422 with per-field errors.
- Only validated fields are stored in `input`; unknown fields are silently dropped. A form with an empty schema stores `input: []`.
- Metadata captured: `ip`, `referer`, `user_agent`. `spam` is set to `false` and `spam_score` to `0`. Entries created through this endpoint are not checked for spam, so `spam_checked_at` is set to the creation time.
- A `FormEntryCreated` event is dispatched. Entries created through this endpoint are not checked for spam, do not alert the form's recipients and keep `user_agent_display: null`; those steps apply only to public submissions (FR-1a).
- Responds `201` with the entry resource.

The entry is created by the `App\Actions\FormEntries\CreateFormEntry` action, shared with FR-1a.

**FR-1a Public submission.** `POST /api/v1/forms/{form}/submissions` (no authentication) is the endpoint browser forms post to.

- A deleted or unknown form returns 404.
- The form must be active, with the same 403 as FR-1.
- If the form's `settings.domains` is non-empty, the `Referer` header's host must match one of them, or the request is rejected with `403 {"message":"Submissions are not accepted from this domain."}`. Matching is case-insensitive; `example.com` matches only that host, and `*.example.org` matches any subdomain (e.g. `forms.example.org`, `a.b.example.org`) but not `example.org` itself. A missing or unparseable `Referer` is rejected. With no domains set, any referer (or none) is accepted. Both checks run before validation.
- Validation, stored `input`, metadata and the `FormEntryCreated` event are the same as FR-1. A `FormEntrySubmitted` event is also dispatched; its listeners parse the user agent and check for spam, and alerts follow the spam check ([Form Notifications](form-notifications.md)).
- **User agent.** `ParseFormEntryUserAgent` uses `donatj/phpuseragentparser` to store `user_agent_display` as `{ "platform": ..., "browser": ..., "browser_version": ... }` (e.g. `Macintosh`, `Chrome`, `129.0.0.0`). Parts the parser cannot identify are `null`; an entry without a user agent keeps `user_agent_display: null`. The listener is queued, so the submission response usually has `user_agent_display: null`; it is filled in once a queue worker runs the listener, and skipped if the entry has been permanently deleted by then.
- **Honeypot.** When `settings.honeypot_enabled` is true, the site's form should include a hidden input named `settings.honeypot_name` that people leave empty. If a submission gives it a non-empty value, it still gets the normal success response (so bots cannot tell) and is stored as usual, but with `spam: true` and `spam_reason: "Honeypot field was filled in."`, and `spam_checked_at` set to the creation time, so it is not sent to Jev and no alerts are sent. The honeypot value itself is not stored. Submissions that fail validation return 422 whether or not the honeypot is filled.
- **Spam classification.** After a submission is stored, the queued `CheckFormEntryForSpam` listener asks Jev (TypeSafe, through `laravel/ai`) whether it is spam, sending the form name, referer and submitted input (truncated to 10,000 characters). Entries already flagged (e.g. by the honeypot) are skipped. The probability is stored in `spam_score`, rounded to 2 decimal places; at 0.9 or above the entry gets `spam: true` and `spam_reason: "Jev classified this entry as spam."`, otherwise `spam: false`; either way `spam_checked_at` records when. Until then `spam_checked_at` is `null`. Without `TYPESAFE_API_KEY`, or when the call fails (logged as a warning), the entry is left as submitted and `spam_checked_at` stays `null`. Either way the listener then fires `FormEntrySpamChecked`, which sends alerts.
- Responds `201` with `{ "data": { "redirect": ..., "message": ... } }` from the form's settings (each `null` when unset). Other settings (`domains`, `timezone`) are not exposed. The API never sends a 3XX: the client shows `message` and/or navigates to `redirect` itself.
- Validation errors are always JSON (422), even for non-JSON requests.
- Rate limited twice, each returning `429` when exceeded: 300 requests per minute per client IP across all forms (`throttle:300,1`), and 60 per minute to each form per client IP (the `form-submissions` limiter in `AppServiceProvider`, keyed by the form ID in the URL plus the IP), so one client cannot block a form for others. Rejected requests (403/404/422) count towards both limits.

**FR-2 List entries.** `GET /api/v1/forms/{form}/entries` returns that form's entries, paginated (15 per page by default; `per_page` sets 1 to 100, anything else returns 422 on `per_page`), with `links` and `meta`. The page size, sort and filters are kept in pagination links.

- **Sorting:** the optional `sort` parameter accepts `created_at` (the default, oldest first) or `spam_score`. Prefix it with `-` for descending order, e.g. `sort=-created_at` for newest first. Ties are broken by ID in the same direction. Any other value, including combined sorts, returns 422 on `sort`.
- **Filtering:** `filter[read]`, `filter[starred]` and `filter[spam]` accept `true`/`false` (`1`/`0` also work). `filter[read]=false` returns unread entries. `filter[spam]=false` includes entries whose spam check has not run (`spam` is `null`). `filter[created_from]` and `filter[created_to]` take `YYYY-MM-DD` dates and are inclusive whole days in UTC; `created_to` must not be before `created_from`. Deleted entries are excluded unless `filter[trashed]` is `with` (include them) or `only` (list only them). Invalid values return 422 on the filter's key, and unknown filter keys return 422 on `filter`. Filters combine with each other and with sorting.

**FR-3 Show an entry.** `GET /api/v1/entries/{entry}` (shallow route).

Every endpoint in this PRD except the public submission (FR-1a) and the signed export download (FR-8) is restricted to the owner of the entry's form; anyone else receives `403 {"message":"You do not own this form."}`. Entries of a deleted form are inaccessible (403) until the form is restored.

**FR-4 Update an entry.** `PUT/PATCH /api/v1/entries/{entry}` accepts:

| Field         | Rules                      |
| ------------- | -------------------------- |
| `spam_score`  | optional, numeric, 0–9.99  |
| `starred`     | optional, boolean          |
| `spam_reason` | nullable, string           |
| `spam`        | nullable, boolean          |
| `read_at`     | nullable, date             |

Every field is optional, so a PATCH can change a single field (e.g. just `read_at`) and leaves the rest untouched; `spam_score` and `starred` cannot be set to `null`, and `spam_score` is rounded to 2 decimal places. The submission fields (`input`, `ip`, `ip_location_display`, `referer`, `user_agent`, `user_agent_display`) are recorded at submission time and are read-only: sending any of them, even as `null`, returns 422 on that field and nothing is changed. `spam_checked_at` is set by the spam check and is rejected the same way.

Returns the refreshed entry. This is the mechanism for starring, marking read/unread, and flagging spam.

**FR-5 Response shape.** Entries are returned as `{ "data": { id, form_id, input, ip, ip_location_display, referer, user_agent, user_agent_display, spam, spam_score, spam_reason, spam_checked_at, starred, read_at, created_at, updated_at, deleted_at } }`, wrapped in `data` like forms and notifications. The submitted values are under `data.input`. `user_agent_display` is an object (see FR-1a) or `null`. `spam_score` is serialised as a number with at most 2 decimal places (e.g. `0.97`). `spam_checked_at`, `read_at`, `created_at`, `updated_at` and `deleted_at` are ISO 8601 UTC strings with microseconds (e.g. `2026-01-02T03:04:05.000000Z`); `deleted_at` is `null` unless the entry was listed or exported with `filter[trashed]`.

**FR-6 Delete, restore and permanently delete an entry.**

- `DELETE /api/v1/entries/{entry}` soft-deletes the entry and returns `204`. A deleted entry returns 404 from show and update.
- `POST /api/v1/entries/{entry}/restore` clears `deleted_at` and returns `200` with the entry resource.
- `DELETE /api/v1/entries/{entry}/force` permanently removes an entry and returns `204`. Only entries that are already deleted can be permanently deleted; anything else returns `409 {"message":"Only deleted entries can be permanently deleted."}`. Unlike forms, entries hold submitters' personal data, so erasure is supported.

**FR-7 Bulk actions.** `POST /api/v1/forms/{form}/entries/bulk` with `{ "action": "...", "ids": ["..."] }` applies one action to up to 100 entries of the form and returns `{ "data": { "action": "...", "affected": n } }`.

- `mark_read`, `mark_unread`, `star`, `unstar`, `mark_spam`, `mark_not_spam` and `delete` apply to entries that are not deleted. `restore` and `force_delete` apply to deleted entries.
- Every ID must belong to the form and be in the right deleted state for the action; otherwise the request returns 422 on `ids.N` and nothing changes. An unknown action returns 422 on `action`; an empty list or more than 100 IDs returns 422 on `ids`.
- Triage actions skip entries already in the target state, so `affected` counts entries that changed and `mark_read` keeps existing read times. `mark_not_spam` also sets `spam` to `false` on entries whose spam check has not run.

**FR-8 Export entries.** Exports are generated in the background so large forms never hold a request open.

- `POST /api/v1/forms/{form}/entries/exports` accepts the same `filter[...]` and `sort` parameters as the list (in the body or query string, without pagination) and the same 422 rules. It stores a `form_entry_exports` record, queues `GenerateFormEntryExport`, and returns `202` with a `Location` header pointing at the export.
- `GET /api/v1/entry-exports/{export}` returns `{ "data": { id, form_id, status, parameters, filename, row_count, error, download_url, completed_at, expires_at, created_at, updated_at } }`. `status` moves from `pending` to `processing` to `completed` or `failed`; clients poll until it leaves `pending`/`processing`. `download_url` is `null` until the export is `completed`, then a temporary signed URL that expires `EXPORT_DOWNLOAD_URL_TTL` minutes (default 5) after the response; poll the export again for a fresh one; `error` explains a failure (including the form being deleted before the export ran).
- `GET /api/v1/entry-exports` lists the user's exports across all their forms, newest first, in the same shape, paginated (15 per page by default; `per_page` sets 1 to 100, anything else returns 422 on `per_page`) with `links` and `meta`. Exports past their `expires_at` and exports of deleted forms are left out.
- `GET /api/v1/entry-exports/{export}/download` is reached only through the signed `download_url`, so a client can pass it to a browser as a plain link. It takes no bearer token; a missing, altered or expired signature returns `403`. It returns the CSV, named `{form-name-slug}-entries-{YYYY-MM-DD}.csv`. It returns `409 {"message":"This export is not ready."}` until the export is completed and `410 {"message":"This export has expired."}` after it expires.
- Exports are kept for 24 hours after they are requested (`expires_at`). An hourly `model:prune` deletes expired exports and their files; after that the export returns 404. Files are written to the default filesystem disk, which is private.
- The entries included are those matching the filters when the job runs, not when the export was requested.
- Columns: `id`, `created_at`, one column per schema field, sorted by `order`, headed by its label (falling back to the field's name), then one column per input key stored on the exported entries that the current schema no longer has (e.g. a removed or renamed field), headed by the stored key and sorted alphabetically, then `read_at`, `starred`, `spam`, `spam_score`, `spam_reason`, `spam_checked_at`, `ip`, `referer`, `user_agent`, `deleted_at`.
- Dates are ISO 8601 UTC (`2026-01-02T03:04:05Z`); booleans are `true`/`false`; `spam_score` is written as in the API (e.g. `0.25`); missing values are empty. List values (e.g. checkboxes) are joined with `, `; other structured values are JSON.
- Cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` so spreadsheet applications do not evaluate submitter input as formulas.

## 6. Gaps

- **Limited spam protection.** FR-1a has rate limiting, an optional honeypot and Jev classification; there is no CAPTCHA. This matters more now that FR-1a is public. The `Referer` check in FR-1a stops casual cross-site posting from browsers, but non-browser clients can set any `Referer`.
- **No IP geolocation** for `ip_location_display`.

## 7. Known issues

- **SMS alerts are not delivered.** Email recipients are alerted when an entry is created; SMS recipients are not. See [Form Notifications](form-notifications.md).

## 8. Open questions

1. Should public submissions have stronger authentication than form ID plus `Referer` (per-form public key, signed requests)?
2. Should entries record which schema version they were validated against, given schemas can change?
3. Should spam-flagged entries be stored, quarantined, or discarded?
4. Should the owner-only authenticated `POST /api/v1/forms/{form}/entries` (FR-1) be kept now that FR-1a exists?
