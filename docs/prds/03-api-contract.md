# 3. API Contract

This is the chapter where exactness matters most. When in doubt, run the Laravel app and compare the responses. Its Scramble docs at `/docs/api` (and `/docs/api.json`) list every route with its request and response shapes.

Requests and responses are JSON. All routes are under `/api/v1`. They require a JWT bearer token (ch. 5) unless the route table says otherwise.

## 3.1 Route table

| Method     | Path                                        | Auth      | Handler                                         | Success |
| ---------- | ------------------------------------------- | --------- | ----------------------------------------------- | ------- |
| GET        | `/forms`                                    | JWT       | list own forms                                  | 200     |
| POST       | `/forms`                                    | JWT       | create form                                     | **201** |
| GET        | `/forms/:form`                              | JWT       | show form                                       | 200     |
| PUT, PATCH | `/forms/:form`                              | JWT       | update form                                     | 200     |
| DELETE     | `/forms/:form`                              | JWT       | soft-delete form                                | **204** |
| POST       | `/forms/:form/restore`                      | JWT       | restore form (resolves soft-deleted rows)       | 200     |
| POST       | `/forms/:form/duplicate`                    | JWT       | copy form                                       | **201** |
| GET        | `/forms/:form/entries`                      | JWT       | list entries                                    | 200     |
| POST       | `/forms/:form/entries`                      | JWT       | create entry (authenticated)                    | **201** |
| POST       | `/forms/:form/entries/bulk`                 | JWT       | bulk triage                                     | 200     |
| POST       | `/forms/:form/entries/exports`              | JWT       | queue CSV export                                | **202** |
| GET        | `/entries/:entry`                           | JWT       | show entry                                      | 200     |
| PUT, PATCH | `/entries/:entry`                           | JWT       | update entry                                    | 200     |
| DELETE     | `/entries/:entry`                           | JWT       | soft-delete entry                               | **204** |
| POST       | `/entries/:entry/restore`                   | JWT       | restore entry (resolves soft-deleted rows)      | 200     |
| DELETE     | `/entries/:entry/force`                     | JWT       | permanently delete a deleted entry              | **204** |
| GET        | `/entry-exports`                            | JWT       | list own exports                                | 200     |
| GET        | `/entry-exports/:export`                    | JWT       | show export                                     | 200     |
| GET        | `/entry-exports/:export/download`           | signature | download CSV                                    | 200     |
| GET        | `/forms/:form/notifications`                | JWT       | list recipients                                 | 200     |
| POST       | `/forms/:form/notifications`                | JWT       | add recipient                                   | **201** |
| GET        | `/notifications/:notification`              | JWT       | show recipient                                  | 200     |
| PUT, PATCH | `/notifications/:notification`              | JWT       | update recipient                                | 200     |
| DELETE     | `/notifications/:notification`              | JWT       | soft-delete recipient                           | **204** |
| POST       | `/notifications/:notification/restore`      | JWT       | restore recipient (resolves soft-deleted rows)  | 200     |
| POST       | `/forms/:form/submissions`                  | none      | public submission                               | **201** |
| POST       | `/webhooks/postmark/bounces`                | basic     | Postmark bounce webhook                         | **204** |

The `/auth/*` routes (login, refresh, logout, me, profile, password, password reset) are specified in chapter 5. Outside `/api/v1` there are `GET /up` and the `/` redirect (ch. 1 §1.4).

Entries and notifications use Laravel's "shallow" nesting: create and list go through the form, while show, update, delete and restore use the child's own ID. Register both `@Put()` and `@Patch()` on the same handler.

Every JWT route also runs the token-version check (ch. 5 §5.6).

**CORS.** The Laravel app has no `config/cors.php`, so the framework default applies to every `/api/*` path: any origin, any method, any request header, no credentials, no exposed headers, `max_age` 0, and preflight `OPTIONS` answered with 204. Match it with `app.use('/api', cors({ origin: '*', maxAge: 0 }))`, not `app.enableCors()`, which would also cover `/up` and `/docs`. Under Express 5, `app.use('/api', …)` needs no wildcard. Browser forms posting to public submissions from other sites depend on it. CORS headers must also be on error responses (401/404/422/429), which holds as long as the `cors` middleware runs before anything that can throw.

## 3.2 Cross-cutting shapes

### Request input

Laravel prepares the input before any validator sees it. Port each step into `common/http/request-input.ts` and `body-parsers.ts`, and run the steps for every route:

1. **Parse the body.**
   - **JSON:** a body that fails to parse becomes `{}`. Laravel's `$request->json()` decodes it to `null` and carries on, so the client gets 422 for the missing fields rather than 400.
   - **`application/x-www-form-urlencoded`:** parse with `qs` (`extended: true`).
   - **`multipart/form-data`:** parse the text fields with `multer`. Laravel parses multipart natively, and an HTML form with `enctype="multipart/form-data"` must keep working. File fields only matter if production schemas use `file`/`image` rules (ch. 4 §4.3).
   - A body over the size limit → 413 JSON.
2. **PHP key rewriting** (urlencoded, multipart and query string only, not JSON): PHP replaces `.` and spaces in top-level field names with `_`. `first name=Ann` and `user.email=x` arrive as `first_name` and `user_email`. Copy this.
3. **Trim and empty to null.** Laravel's global `TrimStrings` and `ConvertEmptyStringsToNull` middleware run on the query string and the body, nested values included. Every string is trimmed (Unicode whitespace too, as Laravel's `Str::trim` does), and `""` then becomes `null`. Skip `password`, `password_confirmation` and `current_password`. This changes stored values: a submitted `" Ann "` is stored as `"Ann"`, and `""` is stored as `null`.
4. **Merge.** The validator input is `{ ...query, ...body }` at the top level, so a body key wins over a query key. This is Laravel's `$request->all()`, and every Form Request validates it. It applies to every endpoint, not only the export and honeypot cases called out below. For example, a public submission's `?email=x` validates and is stored when the body has no `email`.

Validated values are copied from this prepared input, never from `req.body`.

### JSON encoding

Laravel encodes responses with `json_encode` options `0`. That escapes `/` as `\/` and non-ASCII characters as `\uXXXX`. `JSON.stringify` does neither. Both decode to the same values, so **parity means equal parsed values with equal key order**, not equal bytes. Don't write a PHP-style encoder. Object key order is part of the contract: emit keys in the order shown in each resource below.

Numbers: a JSON number round-trips through PHP as `int` or `float`. `1.0` in a submission comes back from Laravel as `1.0`, and from Node as `1`. Integers above 2^53 lose precision in Node. Accept both differences and note them in the contract suite's normaliser.

### Single resource

```json
{ "data": { ...fields } }
```

### Timestamps

Every timestamp in a JSON response is ISO 8601 in UTC with **six** fractional digits and a `Z` suffix, e.g. `2026-01-02T03:04:05.000000Z`. This includes `read_at`, `spam_checked_at`, `completed_at`, `expires_at` and `email_verified_at`. JavaScript's `toISOString()` gives three digits, so format these explicitly (e.g. `d.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z')`). Columns store whole seconds, so in practice the digits are always `000000`.

### Paginated collection

`?page=N` selects the page. `?per_page=N` sets the page size where the endpoint allows it (1 to 100, default 15). Anything else returns 422 on `per_page` ("The per page field must be between 1 and 100." / "must be an integer."). Out-of-range pages return an empty `data` array with 200.

`page` is never validated. Laravel's paginator uses it only when `filter_var($page, FILTER_VALIDATE_INT)` passes and the value is at least 1. Otherwise it uses page 1. So `?page=abc`, `?page=0`, `?page=-2` and `?page[]=2` all give page 1 with 200.

```json
{
  "data": [ ...resources ],
  "links": {
    "first": "http://host/api/v1/forms?page=1",
    "last":  "http://host/api/v1/forms?page=1",
    "prev":  null,
    "next":  null
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "links": [
      { "url": null, "label": "&laquo; Previous", "page": null, "active": false },
      { "url": "http://host/api/v1/forms?page=1", "label": "1", "page": 1, "active": true },
      { "url": null, "label": "Next &raquo;", "page": null, "active": false }
    ],
    "path": "http://host/api/v1/forms",
    "per_page": 15,
    "to": 1,
    "total": 1
  }
}
```

Rules to implement in `common/http/paginate.ts`:

- `last_page = max(ceil(total / per_page), 1)`.
- `from` / `to` are 1-based item positions. Both are `null` when the page is empty.
- `path` is the **request's** scheme, host and path (`req.protocol`, `req.get('host')`, `req.path`), not `APP_URL`. Behind a trusted proxy this is the forwarded scheme and host.
- Query strings are encoded as PHP's `http_build_query(..., PHP_QUERY_RFC3986)` does. Brackets are percent-encoded (`filter%5Bread%5D=true`), spaces become `%20`, and `page` always comes **last**.
- Which query parameters are kept depends on the endpoint:

  | Endpoint                         | `per_page` accepted | Other query parameters in links |
  | -------------------------------- | ------------------- | ------------------------------- |
  | `GET /forms`                     | yes                 | all kept                        |
  | `GET /forms/:form/entries`       | yes                 | all kept                        |
  | `GET /entry-exports`             | yes                 | all kept                        |
  | `GET /forms/:form/notifications` | no (always 15)      | dropped                         |

- `meta.links` is a window of page numbers. With more than about 10 pages, Laravel inserts `{ "url": null, "label": "...", "page": null, "active": false }` separators: an `onEachSide` of 3, plus the first two and last two pages. Copy the algorithm from `Illuminate\Pagination\UrlWindow` exactly.

List items **inside** `data` use the same resource shape as the single resource, minus the wrapper.

### Errors

| Case                                                     | Status | Body                                                                     |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| No or invalid token                                      | 401    | `{"message":"Unauthenticated."}`                                         |
| Not the owner                                            | 403    | `{"message":"You do not own this form."}`                                |
| Form inactive (submissions)                              | 403    | `{"message":"This form is not accepting submissions."}`                  |
| Referer not allowed (public submissions)                 | 403    | `{"message":"Submissions are not accepted from this domain."}`           |
| Bad or expired download signature                        | 403    | `{"message":"Invalid signature."}`                                       |
| Unknown or soft-deleted ID, invalid ULID, unknown route  | 404    | `{"message":"..."}` (text not contractual)                               |
| Wrong method on a known path                             | 405    | `{"message":"The POST method is not supported for route api/v1/forms/x. Supported methods: GET, HEAD, PUT, PATCH, DELETE."}` (text not contractual) plus an `Allow` header. Express returns 404 by default, so add a fallback that checks the path against the route table |
| Body too large (over `post_max_size`, 2 MB in production) | 413   | Laravel's `ValidatePostSize` throws `PostTooLargeException` with an empty message. Capture the exact body from the reference app |
| Force-deleting an entry that isn't deleted               | 409    | `{"message":"Only deleted entries can be permanently deleted."}`         |
| Downloading an export that isn't completed               | 409    | `{"message":"This export is not ready."}`                                |
| Downloading an expired export                            | 410    | `{"message":"This export has expired."}`                                 |
| Validation failure                                       | 422    | see below                                                                |
| Throttled                                                | 429    | `{"message":"Too Many Attempts."}` plus `Retry-After` (seconds until the window ends). Laravel's `X-RateLimit-*` headers aren't sent (see _Rate limiting_ below) |
| Unhandled                                                | 500    | `{"message":"Server Error."}` (no stack traces outside dev)              |

Validation error body:

```json
{
    "message": "The name field is required. (and 1 more error)",
    "errors": {
        "name": ["The name field is required."],
        "email": ["The email field is required."]
    }
}
```

- `message` is the first error message. When there are N > 1 errors in total, append ` (and N-1 more error)`, or ` (and N-1 more errors)` when N-1 > 1.
- `errors` is keyed by field (dot notation for nested keys: `settings.redirect`, `schema.0.id`, `ids.3`), and each value lists messages in rule order.
- Use Laravel's English message templates (`lang/en/validation.php` in `laravel/framework`) for every rule you support. The attribute name is the field key with `_` replaced by spaces. Rules this API uses beyond the basics: `missing` ("The :attribute field must be missing."), `list`, `ulid`, `distinct`, `date_format`, `after_or_equal`, `exists`, `between`, `timezone`, `url`, `regex`, `confirmed`, `different`, `unique`, `current_password`, and the `password.*` messages.

Every endpoint validates with the ch. 4 rule engine. Each Form Request becomes a rule array in `rules/*.rules.ts`, applied through a `@Validated(rules)` parameter decorator. Fixed endpoints and form schemas therefore produce identical error bodies from one set of message templates.

**Order of checks** matches Laravel's Form Requests: authenticate (401) → find the record (404) → authorise (403) → validate (422). For example, a non-owner gets 403 even when the body is invalid. In Nest this falls out naturally: guards run before the `@Validated()` parameter decorator.

### Rate limiting

There are three HTTP rate limits, built on `@nestjs/throttler` with `@nest-lab/throttler-storage-redis` as the store. The login limit is separate (ch. 5 §5.4).

| Throttler name     | Limit             | Counted by                          | Routes                                  |
| ------------------ | ----------------- | ----------------------------------- | --------------------------------------- |
| `submissions-ip`   | 300 per 60 s      | client IP                           | `POST /forms/:form/submissions`         |
| `submissions-form` | 60 per 60 s       | raw `:form` URL segment + `\|` + IP | `POST /forms/:form/submissions`         |
| `password`         | 6 per 60 s        | client IP                           | `POST /auth/forgot-password` and `POST /auth/reset-password`, sharing **one** counter |

Each throttler has its own counter, so submissions and password reset don't affect each other (F9, §3.6).

**`LaravelThrottlerGuard`** (`common/rate-limit/`) extends `ThrottlerGuard` and overrides only the package's supported hooks:

- **`getTracker`** returns Laravel's `$request->ip()`: the first entry of the Symfony-ordered client list (§3.5). Don't use the default, which reads `req.ip` and groups IPv6 addresses by /64. Laravel counts each exact address. `submissions-form` prefixes the tracker with the raw `:form` parameter, so unknown form IDs are counted too.
- **`generateKey`** returns `sha1(throttlerName + '|' + tracker)`. The default key includes the controller and handler names, which would give forgot and reset separate counters. The storage adds the throttler name to the Redis key as well, which keeps the three counters apart.
- **`throwThrottlingException`** sets `Retry-After` to `timeToExpire` (the seconds left in the window, as Laravel's `availableIn` gives) and throws with the message `Too Many Attempts.` (also set with the module's `errorMessage` option).

Module settings:

- **`blockDuration: 1`** (ms) on every throttler. By default the package blocks for a whole TTL, starting at the first request over the limit, so a client that goes over at 0:59 would be locked out until about 1:59. Laravel blocks only until the current window ends. With a 1 ms block, every request over the limit is blocked again until the window's counter expires, which is Laravel's fixed window. A test must pin this behaviour, because it relies on how the Redis storage's Lua script works.
- **`setHeaders: false`**. The package's header names get a suffix for every named throttler (`X-RateLimit-Limit-submissions-form`), and its `X-RateLimit-Reset` is a number of seconds, not Laravel's Unix timestamp. Neither client reads these headers. The Next and Nuxt apps use only the status code and pass on `Retry-After` (checked 2026-10-03). So the port sends no `X-RateLimit-*` headers at all, rather than misleading ones. This is a **documented difference**, and the contract suite ignores these headers.
- Register the throttlers in the order above. The guard checks them in that order, and each check counts the request before deciding, so a request that `submissions-form` rejects still counts toward `submissions-ip`. Laravel's two middleware behave the same way.

Apply the guard only to the three routes, through a `@RateLimited(...names)` decorator. It adds `@UseGuards(LaravelThrottlerGuard)` and `@SkipThrottle` for the throttlers the route doesn't use. On public submissions it must run **before** the form is looked up, so that unknown IDs are counted and 429 comes before 404.

Storage: `new ThrottlerStorageRedisService(redis)`, using the shared `ioredis` connection (ch. 1 §1.1). Don't use the package's in-memory storage in tests either. It counts in a sliding window, and with `blockDuration: 1` it resets the count when the block ends, so it wouldn't test production behaviour. Throttle e2e tests run against Redis (ch. 7 §7.1).

## 3.3 Authorization

Ownership is enforced everywhere except the public and signed routes. Mirror `FormPolicy`, `FormEntryPolicy`, `FormNotificationPolicy` and `FormEntryExportPolicy`:

- Forms: `form.userId === currentUser.id`.
- Entries, notifications and exports: the child's form must exist and **not be soft-deleted**, and `form.userId === currentUser.id`. A child of a deleted form therefore gets 403, not 404.
- Denial → 403 with `{"message":"You do not own this form."}`.
- `GET /forms` and `GET /entry-exports` are scoped to the current user's forms in the query. `GET /entry-exports` also leaves out exports of deleted forms.

Implement this as a `FormOwnershipGuard` that resolves `:form`, `:entry`, `:notification` or `:export`, loads the owning form, and attaches it to the request. Controllers then read `req.form`.

`POST /forms` is the only authenticated route without an ownership check, because it creates a form for the caller.

## 3.4 Forms

**Resource**

```json
{ "data": {
  "id": "01k6…",
  "user_id": 1,
  "name": "Contact Form",
  "active": false,
  "schema": [ { "id": "01J9…A", "order": 1, "label": "Name", "rules": ["required"] } ] | [] | null,
  "settings": { "redirect": null, "timezone": null, "domains": [], "message": null, "honeypot_enabled": false, "honeypot_name": null } | null,
  "created_at": "2026-01-02T03:04:05.000000Z", "updated_at": "…", "deleted_at": null
} }
```

- `schema` is `null`, or the stored list **sorted by `order`** (stable). Field objects are emitted as stored, with only the keys that were sent.
- `settings` is either `null` or an object with **all six** keys, with defaults filled in for any that were not stored.
- List items only also carry `entries_count`, `unread_entries_count` and `spam_entries_count` (below), placed after `settings`.

**List** (`GET /forms`) returns only `currentUser`'s forms, paginated.

- Counts, each excluding soft-deleted entries:
  - `entries_count`: entries where `spam = false OR spam IS NULL`.
  - `unread_entries_count`: the same, and `read_at IS NULL`.
  - `spam_entries_count`: entries where `spam = true`.
- `?sort=`: one of `created_at` (default), `updated_at`, `name`, each optionally prefixed with `-` for descending. Order by the column (for `name`, by `lower(name)`), then by `id` in the same direction. Production Laravel uses SQLite, where `lower()` folds only ASCII letters and the comparison is by bytes. On Postgres, use `ORDER BY lower(name) COLLATE "C"` to get the same byte order. Postgres's `lower()` also folds non-ASCII letters (`É` → `é`), which SQLite's doesn't. Accept that difference for non-ASCII names. Any other value, including a combined sort, → 422 on `sort` ("The selected sort is invalid.").
- `?filter[active]=`: `true`, `false`, `1` or `0` → `WHERE active = …`. Any other value → 422 on `filter.active`. Any other key under `filter` → 422 on `filter`.

**Create** (`POST /forms`) body:

| Field      | Rule                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| `name`     | required, string, max 400                                                                    |
| `schema`   | nullable, **list** (an object or a JSON string → 422 on `schema`). Items as below            |
| `settings` | nullable object. Only the six `FormSettings` keys; any other key → 422 on `settings`         |

Schema item rules (errors keyed `schema.N.<key>`):

| Key         | Rule                                                                  |
| ----------- | --------------------------------------------------------------------- |
| item itself | object with only `id`, `order`, `label`, `name`, `rules` (else 422 on `schema.N`) |
| `id`        | required, ULID (either case), distinct across the schema              |
| `order`     | required, integer                                                     |
| `label`     | nullable string                                                       |
| `name`      | nullable string                                                       |
| `rules`     | nullable; when an array, every item must be a string. A comma-separated string is also accepted |

Also check the rule names (F7, ch. 4 §4.5).

Settings rules (errors keyed `settings.<key>`, `settings.domains.N`):

| Key                | Rule                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `redirect`         | nullable, URL, max 2048                                                                                                |
| `timezone`         | nullable, valid PHP timezone identifier (use `Intl.supportedValuesOf('timeZone')` plus `UTC`, and check it against PHP's list) |
| `domains`          | nullable, list. Each item required, string, max 253, matching `^(?=.{1,253}$)(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` (case-insensitive) |
| `message`          | nullable string, max 2000                                                                                              |
| `honeypot_enabled` | boolean (`true false 1 0 "1" "0"`)                                                                                     |
| `honeypot_name`    | nullable string, max 255, `^[A-Za-z0-9_-]+$`                                                                           |

**Honeypot name** (port of `FormSettingsValidationRules`):

1. **Before validation:** if `settings` was sent with `honeypot_enabled` truthy (`true`, `1`, `"1"`) and `honeypot_name` is missing, `null` or `""`, fill it in. On update, reuse the form's stored `honeypot_name` if it has one and it doesn't clash with the schema's input names. Otherwise generate one: one of `website`, `homepage`, `url`, `company`, then `_`, then 6 random lowercase letters/digits (`website_k3x9qa`), retrying until it doesn't clash. The schema used is the request's `schema` if sent, otherwise the stored one.
2. **After validation:** if the honeypot name equals any schema input name (`field.name ?? field.id`), add an error. Use `settings.honeypot_name` ("The honeypot name must not match a schema field.") when `settings` was sent. Otherwise use `schema` ("The schema must not contain a field named after the honeypot."). Use stored values for whichever of `schema` / `settings` was omitted.

On create, set `user_id` from the auth user and ignore it if the body contains it. `active` is **not** accepted on create (it's dropped) and always starts as `false`. Emit `form.created`, then return 201.

**Update** (`PUT/PATCH /forms/:form`): authorise first (403), then validate `name` (required, string, max 400), `active` (required, boolean), and `schema` and `settings` as on create. Update only the validated keys, so an omitted `schema` or `settings` is left unchanged and `null` clears it. Return 200 with the resource.

"Boolean" means Laravel's `boolean` rule: `true`, `false`, `1`, `0`, `"1"`, `"0"`. The **strings** `"true"` and `"false"` are rejected. Coerce accepted values to boolean before saving.

**Delete** → soft delete, 204. Entries, notifications and exports are left alone. A deleted form returns 404 from every `:form` route except restore, including public submissions.

**Restore** → clears `deleted_at`, returns 200 with the resource. It works on a form that isn't deleted too, returning it unchanged.

**Duplicate** → new form with the same `user_id`, `schema` and `settings`, `active = false`, and name = the first 393 characters of the original + `" (copy)"`. Don't copy entries, notifications or exports. Emit `form.created`. Return 201. Authorised as `view` (owner only).

## 3.5 Entries

**Resource**

```json
{ "data": {
  "id": "01k6…",
  "form_id": "01k6…",
  "input": { "field": "value" } | [],
  "ip": "203.0.113.7",
  "ip_location_display": null,
  "referer": "https://example.com/contact",
  "user_agent": "Mozilla/5.0 …",
  "user_agent_display": { "platform": "Macintosh", "browser": "Chrome", "browser_version": "129.0.0.0" } | null,
  "spam": false,
  "spam_score": 0,
  "spam_reason": null,
  "spam_checked_at": "2026-01-02T03:04:05.000000Z" | null,
  "starred": false,
  "read_at": "2026-01-02T03:04:05.000000Z" | null,
  "created_at": "2026-01-02T03:04:05.000000Z",
  "updated_at": "2026-01-02T03:04:05.000000Z",
  "deleted_at": null
} }
```

- `spam_score`: the stored 2-decimal value as a JSON number, e.g. `0.97`, `0.5`, `0`. The CSV export writes the same value (ch. 6 §6.6).
- `spam` can be `null`.
- `deleted_at` is non-null only when an entry is listed with `filter[trashed]`.

**List** (`GET /forms/:form/entries`): owner only. Entries where `form_id = :form`, paginated, with `per_page`.

- `?sort=`: `created_at` (default) or `spam_score`, optional `-` prefix. Then `id` in the same direction. Anything else → 422 on `sort`.
- Filters (all optional, unknown key → 422 on `filter`, bad value → 422 on `filter.<key>`):

  | Filter                  | Values                         | Meaning                                                                 |
  | ----------------------- | ------------------------------ | ----------------------------------------------------------------------- |
  | `filter[read]`          | `true false 1 0`               | `read_at IS NOT NULL` / `IS NULL`                                       |
  | `filter[starred]`       | `true false 1 0`               | `starred = …`                                                           |
  | `filter[spam]`          | `true false 1 0`               | `spam = true` / `(spam = false OR spam IS NULL)`                        |
  | `filter[created_from]`  | `YYYY-MM-DD`                   | `created_at >= day 00:00:00 UTC`                                        |
  | `filter[created_to]`    | `YYYY-MM-DD`, ≥ `created_from` | `created_at <= day 23:59:59.999999 UTC`. Before `created_from` → 422 on `filter.created_to`. Allowed without `created_from` |
  | `filter[trashed]`       | `with`, `only`                 | Include deleted entries, or list only deleted entries                   |

**Create, authenticated** (`POST /forms/:form/entries`). Order of checks:

1. Form missing or deleted → 404. Not the owner → 403 "You do not own this form.". Form inactive → 403 "This form is not accepting submissions.".
2. Build rules from `form.schema` (ch. 4) and validate the body. On failure → 422.
3. Store the entry with `CreateFormEntry` (below), with `spam_checked_at = now`.
4. Emit `form-entry.created`. Don't emit `form-entry.submitted`: no spam check, no alerts, no user-agent parsing.
5. Return 201 with the entry resource.

**`CreateFormEntry`** (shared with public submissions):

- `input` = **only** the validated keys. Unknown keys are dropped, and keys absent under a `sometimes` rule are omitted. If nothing validates, store `[]`.
- `ip` = every client IP, comma-joined, in **Symfony's order**. Port `Request::getClientIps()` rather than using `req.ips`:
  1. Take the `X-Forwarded-For` entries, but only when the socket address is a trusted proxy. Append the socket address.
  2. Strip ports and `::ffff:` prefixes, and drop entries that aren't valid IPs.
  3. Remove every trusted-proxy address.
  4. **Reverse** the list, so the hop nearest the server comes first and the original client last.
  5. If nothing is left, use the first trusted address that was removed.

  With `TRUSTED_PROXIES=*`, `X-Forwarded-For: 1.1.1.1, 2.2.2.2` and a proxy socket, the result is `2.2.2.2,1.1.1.1`. Laravel's `$request->ip()` is the first entry (`2.2.2.2`). Every per-IP rate limit and the login throttle key use that value. Capture a fixture from the reference app to confirm it.

  The Next and Nuxt clients call the API from their own servers. They set `X-Forwarded-For` to the browser's IP (`lib/backend/client.ts` in Next, `server/utils/backend.ts` in Nuxt), so that the login and password-reset throttles count each browser separately. That only works when the client servers' addresses are covered by `TRUSTED_PROXIES`. Otherwise every user of a client shares one throttle bucket.

**Production today:** `TRUSTED_PROXIES` is empty, and the front end runs on the same host (`localhost:3000`) (confirmed 2026-10-03). Laravel therefore ignores the forwarded header, and every request through the front end comes from `127.0.0.1`. As a result:
- All users share the front end's single 6/min forgot/reset-password limit.
- The login throttle is keyed by `email|127.0.0.1`. That's still separate for each email, but a failed attempt from anywhere counts toward everyone's lockout on that email.

Setting `TRUSTED_PROXIES=127.0.0.1` fixes this. It's a configuration change rather than a code change, so it isn't a parity difference. **Decided 2026-10-03:** set it on Laravel now, and give Nest the same value. Capture the reference fixtures with this setting. Public submissions post directly from customers' browsers, so they're unaffected.
- `referer` = the `Referer` header truncated to 255 characters, or `null` when missing or empty.
- `user_agent` = the `User-Agent` header or `null`.
- `spam` = `true` if a spam reason was given, otherwise `false`. `spam_score` = 0. `spam_reason` = the reason or `null`.
- `spam_checked_at` = `null` if the entry awaits a spam check (clean public submissions), otherwise now.
- `starred` = `false`, `read_at` = `null`, `user_agent_display` = `null`.

**Show** → 200 with the resource. Owner only. Deleted entry → 404.

**Update** (`PUT/PATCH /entries/:entry`): owner only, checked before validation. Every field is optional.

| Field                                                                                           | Rule                                                        |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `spam_score`                                                                                    | if present: required (not null), numeric, between 0 and 9.99. Rounded to 2 decimals when saved |
| `starred`                                                                                       | if present: required (not null), boolean                    |
| `spam`                                                                                          | nullable, boolean                                           |
| `spam_reason`                                                                                   | nullable, string                                            |
| `read_at`                                                                                       | nullable, date (any string `Date` can parse)                |
| `input`, `ip`, `ip_location_display`, `referer`, `user_agent`, `user_agent_display`, `spam_checked_at` | **missing**: present at all, even as `null` → 422 "The X field must be missing." |

Update only the keys that were sent. Reload, then return the entry resource.

**Delete** → soft delete, 204. **Restore** → resolves deleted rows, clears `deleted_at`, returns 200 with the resource. **Force delete** → resolves deleted rows. Owner check first (403). If the entry isn't deleted → 409 "Only deleted entries can be permanently deleted.". Otherwise delete the row permanently, 204.

**Bulk** (`POST /forms/:form/entries/bulk`): owner only (authorised as `update` on the form). Body `{ "action": "...", "ids": ["..."] }`.

- `action`: required, one of `mark_read`, `mark_unread`, `star`, `unstar`, `mark_spam`, `mark_not_spam`, `delete` (for entries that aren't deleted), or `restore`, `force_delete` (for deleted entries). Anything else → 422 on `action`.
- `ids`: required array with 1 to 100 items → else 422 on `ids`. Each item: required, string, distinct, and must be an entry of **this form** in the right deleted state for the action → else 422 on `ids.N` ("The selected ids.N is invalid."). Nothing changes on any error.
- Effects, counting only rows that change:

  | Action          | Update                         | Only rows where                 |
  | --------------- | ------------------------------ | ------------------------------- |
  | `mark_read`     | `read_at = now`                | `read_at IS NULL`               |
  | `mark_unread`   | `read_at = null`               | `read_at IS NOT NULL`           |
  | `star`          | `starred = true`               | `starred = false`               |
  | `unstar`        | `starred = false`              | `starred = true`                |
  | `mark_spam`     | `spam = true`                  | `spam = false OR spam IS NULL`  |
  | `mark_not_spam` | `spam = false`                 | `spam = true OR spam IS NULL`   |
  | `delete`        | soft delete                    | not deleted                     |
  | `restore`       | clear `deleted_at`             | deleted                         |
  | `force_delete`  | delete permanently             | deleted                         |

- Response 200: `{ "data": { "action": "mark_read", "affected": 3 } }`. Every update, soft delete and restore above also sets `updated_at = now` on the changed rows, as Eloquent's query builder does.

## 3.6 Public submissions

`POST /forms/:form/submissions`: no authentication. Browser forms post here.

1. **Rate limits**, both applied before anything else, and both counting rejected requests:
   - 300 requests per minute per client IP, across all forms.
   - 60 requests per minute per client IP **per form**, keyed by the raw `:form` URL segment + `|` + IP (so it works for unknown IDs too).

   Exceeded → 429 `{"message":"Too Many Attempts."}` with `Retry-After`. The throttlers are `submissions-ip` and `submissions-form` (§3.2, _Rate limiting_).

   **F9: separate counters.** In Laravel, the 300/min limit is the unnamed `throttle:300,1`. Its key is `sha1(route domain + '|' + ip)`, which is `sha1('|' . ip)` with no route domain. The forgot/reset-password routes use unnamed `throttle:6,1`, which builds the **same key**. So the two limits share one counter per IP:
   - 6 public submissions in a minute, then a `forgot-password` request from the same IP → 429.
   - Password-reset requests count toward the 300 submissions.

   The port gives each limit its own counter. The contract suite tags this case F9:
   - against Laravel, 6 submissions followed by a forgot-password request gets 429;
   - against Nest, the same sequence gets 200.
2. Form missing or soft-deleted → 404.
3. Form inactive → 403 "This form is not accepting submissions.".
4. **Domain check.** If `settings.domains` is non-empty, parse the `Referer` header's host and lowercase it. It must equal a domain (compared case-insensitively), or end with `.example.org` for a `*.example.org` entry. A wildcard doesn't match the bare domain. A missing or unparseable `Referer` fails the check. On failure → 403 "Submissions are not accepted from this domain.". With no domains, anything passes.
5. Validate against the schema rules (ch. 4). On failure → 422 JSON, even for `application/x-www-form-urlencoded` requests.
6. **Honeypot.** If `settings.honeypot_enabled` and `honeypot_name` are set and the request has a non-empty value under that name, the spam reason is `"Honeypot field was filled in."`. Check the merged body **and** query string, as Laravel's `$request->all()` does. Empty means `null`, `""` or `[]`. The honeypot value is never stored, because it isn't in the schema.
7. Store with `CreateFormEntry`. With a honeypot hit: `spam: true`, the reason above, `spam_checked_at = now`. Otherwise: `spam: false`, `spam_checked_at = null` (awaiting Jev).
8. Emit `form-entry.created`, then `form-entry.submitted` (ch. 6).
9. Return **201** `{ "data": { "redirect": <settings.redirect>, "message": <settings.message> } }`. Each is `null` when unset or when the form has no settings. Never redirect with a 3XX. Honeypot hits get exactly the same response.

Accept JSON, `application/x-www-form-urlencoded` and `multipart/form-data` bodies, since plain HTML forms post the latter two. Multipart is a confirmed product requirement (2026-10-03), not just parity. File parts in a multipart submission are ignored: they aren't parsed into `input`, because no supported rule accepts files. Prepare the input as in §3.2 (_Request input_): PHP key rewriting, trimming, empty strings to `null`, and the query string merged in. The domain check is the access control, not CORS.

## 3.7 Exports

**Queue an export** (`POST /forms/:form/entries/exports`): owner only. Accepts the entry list's `sort` and `filter[...]` (and `per_page`, which is validated but ignored), from the body or the query string, with the same 422 rules.

1. Create a `form_entry_exports` row: `status: "pending"`, `parameters` = the validated `{sort?, filter?}` only, `disk` = the configured disk, `filename` = `{slug(form.name) || "form"}-entries-{YYYY-MM-DD}.csv` (UTC date), `expires_at` = now + 24 h.
2. Enqueue `generate-form-entry-export { exportId }` (ch. 6 §6.6).
3. Respond **202** with the export resource and a `Location` header holding the absolute URL of `GET /entry-exports/:id`.

`slug` must match Laravel's `Str::slug`: transliterate to ASCII, lowercase, replace each run of non-alphanumeric characters with `-`, and trim `-`. `@` becomes `-at-`.

**Resource**

```json
{ "data": {
  "id": "01k6…", "form_id": "01k6…",
  "status": "pending" | "processing" | "completed" | "failed",
  "parameters": { "sort": "-created_at", "filter": { "spam": "false" } } | {},
  "filename": "contact-form-entries-2026-10-01.csv",
  "row_count": 42 | null,
  "error": null | "The form was deleted." | "The export could not be generated.",
  "download_url": "https://host/api/v1/entry-exports/01k6…/download?expires=1759350000&signature=…" | null,
  "completed_at": "…" | null, "expires_at": "…", "created_at": "…", "updated_at": "…"
} }
```

There's no `deleted_at`. `parameters` is always an object. `download_url` is `null` unless the status is `completed`.

**Signed download URL** (port of `URL::temporarySignedRoute(..., absolute: false)`):

1. `expires` = now + `EXPORT_DOWNLOAD_URL_TTL` minutes, as Unix seconds.
2. `relative` = `/api/v1/entry-exports/{id}/download?expires={expires}`.
3. `signature` = hex HMAC-SHA256 of `relative`, keyed with `APP_KEY` (decode a `base64:` prefix first).
4. Return the request's scheme + host + `relative` + `&signature=…`.

Because only the path and query are signed, the link still validates behind a proxy with a different host or scheme. Don't try to validate links issued by Laravel: they expire within minutes of cut-over.

**Show** (`GET /entry-exports/:export`): owner of the export's form, which must not be deleted (otherwise 403). A fresh `download_url` is generated on every call.

**List** (`GET /entry-exports`): exports of the current user's **non-deleted** forms with `expires_at > now`, newest first (`created_at DESC, id DESC`), paginated with `per_page`.

**Download** (`GET /entry-exports/:export/download`): no JWT. Ignore any `Authorization` header.

1. Verify `signature` against the relative URL with the `signature` parameter removed, using a constant-time compare, and check that `expires` is in the future. Missing, altered or expired → 403 "Invalid signature.".
2. Unknown export → 404.
3. `expires_at` is past → 410 "This export has expired.".
4. Status isn't `completed`, or there's no `path` → 409 "This export is not ready.".
5. Stream the file with `Content-Type: text/csv; charset=UTF-8` and `Content-Disposition: attachment; filename=<filename>`.

The CSV format is in chapter 6 §6.6.

## 3.8 Notifications

**Resource**

```json
{ "data": { "id": "01k6…", "form_id": "01k6…", "type": "email" | "sms", "value": "…", "enabled": true, "error": null, "created_at": "…", "updated_at": "…", "deleted_at": null } }
```

**List**: owner only. The form's recipients that aren't deleted, in insertion order, 15 per page, query parameters dropped (§3.2).

**`value` rules** depend on the sent `type`:

| `type`      | `value` rule                                                     |
| ----------- | ---------------------------------------------------------------- |
| `email`     | required, string, max 255, email                                 |
| `sms`       | required, string, matching `^\+[1-9]\d{1,14}$` (E.164)           |
| other/missing | required, string, max 255                                      |

**Create** (`POST /forms/:form/notifications`): owner only (authorised as `update` on the form), checked before validation. `type` (required, `email` | `sms`), `value` (above), `enabled` (optional boolean, default `true`), `error` (**missing**). Return 201.

**Update** (`PUT/PATCH /notifications/:notification`): owner only, checked before validation. `form_id` (**missing**), `type` (required, in), `value` (above), `enabled` (required, boolean), `error` (**missing**). Return the reloaded resource.

**Delete** → soft delete, 204. **Restore** → resolves deleted rows, 200 with the resource. There's no force delete.

## 3.9 Postmark bounce webhook

`POST /webhooks/postmark/bounces`. Postmark sends the credentials as HTTP basic auth embedded in the webhook URL.

1. If `POSTMARK_WEBHOOK_USERNAME` or `POSTMARK_WEBHOOK_PASSWORD` is empty, or the request's basic-auth user/password don't match (constant-time compare), respond 401 `{"message":"Unauthenticated."}` with `WWW-Authenticate: Basic`.
2. Read `RecordType`, `Type`, `Description` and `Metadata.form_notification_id` from the JSON body.
3. It's a failure if `RecordType` is `SpamComplaint`, or if `RecordType` is `Bounce` and `Type` isn't one of `AutoResponder`, `Subscribe`, `Unsubscribe`, `AddressChange`, `ChallengeVerification`, `OpenRelayTest`.
4. On a failure with a string recipient ID, look up the recipient **including soft-deleted rows**, and set `error` to:
   - `Marked as spam: {Description}` for a spam complaint.
   - `Bounced ({Type or "Unknown"}): {Description}` for a bounce.
   - Omit `: {Description}` when the description is empty. Truncate to 255 characters.
5. Always respond 204, so Postmark doesn't retry.

## 3.10 Example controller

```ts
@Controller('forms')
@UseGuards(JwtAuthGuard, TokenVersionGuard)
export class FormsController {
    constructor(
        private readonly forms: FormsService,
        private readonly events: EventEmitter2,
    ) {}

    @Get()
    async index(@CurrentUser() user: User, @Validated(formIndexRules) input: FormIndexInput, @Req() req: Request) {
        const page = await this.forms.paginateForUser(user.id, input);
        return paginate(page, req, toFormListResource, { keepQuery: true });
    }

    @Post()
    @HttpCode(201)
    async store(@CurrentUser() user: User, @Validated(formStoreRules) input: FormStoreInput) {
        const form = await this.forms.create(user.id, input); // commits before returning
        this.events.emit('form.created', new FormCreated(form));
        return { data: toFormResource(form) };
    }

    @Get(':form')
    @UseGuards(FormOwnershipGuard)
    show(@OwnedForm() form: Form) {
        return { data: toFormResource(form) };
    }
}
```

## Done when

- [ ] Every row in §3.1 is implemented, with PUT and PATCH both working.
- [ ] The pagination envelope matches Laravel's as parsed JSON, including key order and URL strings, for 0, 1, 16 and 200 records, with and without `per_page`, `sort` and `filter`, and with invalid `page` values (compare with the reference app).
- [ ] The 401 / 403 / 404 / 405 / 409 / 410 / 422 / 429 bodies and headers match §3.2.
- [ ] Rate limiting, tested against Redis:
  - the 61st submission to one form in a window gets 429, with `Retry-After` equal to the seconds left in the window;
  - the next window accepts requests again;
  - a request over the limit doesn't extend the lockout;
  - forgot and reset share their counter;
  - submissions don't affect password reset (F9).
- [ ] The §3.2 _Request input_ steps have tests: trimming, empty strings to `null`, query merged with the body, malformed JSON → 422, multipart, and PHP key rewriting.
- [ ] The stored `ip` and the rate-limit key match Laravel's for a fixture `X-Forwarded-For` chain.
- [ ] Each check-order case (404 before 403 before 422) has a test.
- [ ] The quirk tests from the README pass.
