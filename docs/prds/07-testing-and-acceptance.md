# 7. Testing & Acceptance

## 7.1 Test layers

| Layer    | Tool             | Runs against                                                                  | Purpose                                                                         |
| -------- | ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unit     | Jest             | Pure functions                                                                | `buildRules`, `SchemaValidator`, `paginate`, presenters, JWT claims, CSV writer, signed URLs, UA mapping |
| E2E      | Jest + Supertest | Nest app booted in-process, SQLite `:memory:` with `synchronize: true`        | Port of every Pest feature test                                                 |
| Contract | Jest + `fetch`   | **Any** base URL (`CONTRACT_BASE_URL`, `CONTRACT_EMAIL`, `CONTRACT_PASSWORD`) | Proves parity by running the same suite against Laravel and NestJS              |

E2E helpers to write first:

- `createApp()`: boots `AppModule` with a fresh in-memory DB, an in-memory storage disk, a fake mail transport and a fake `JevClient`.
- **Queue mode:** a test-only switch that runs BullMQ processors inline when a job is enqueued (the equivalent of `QUEUE_CONNECTION=sync`). Use `Queue.fake()`-style capture when a test asserts that something was queued but not run.
- `actingAs(user)`: signs a JWT for the user (with the right `tv`) and returns a Supertest agent with the `Authorization` header set. This is the equivalent of Pest's `actingAs`.
- `travel(ms)`: fake timers or an injectable clock, for refresh windows, throttles, export expiry and pruning (Pest's `$this->travel()`).
- Factories from chapter 2 §2.5 that persist through the repositories.

## 7.2 Parity matrix: port every existing test

Each Pest `it(...)` becomes a Jest `it(...)` with the **same name**, in a file with the matching name. Pest datasets (`->with([...])`) become `it.each`. The counts below are `it()` blocks as of commit `6a0fb33`. Recount when you start, and make the Jest file's count match.

| Laravel test file                                       | `it()` | Covers                                                                                                              |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `Http/Controllers/FormControllerTest`                   | 41     | Form CRUD, ownership, sort/filter/`per_page`, entry counts, schema list validation, settings, honeypot names, delete/restore/duplicate |
| `Http/Controllers/FormEntryControllerTest`              | 46     | Entry list/show/create/update, filters and sort, read-only fields, triage, delete/restore/force, bulk actions, ownership |
| `Http/Controllers/FormEntryExportControllerTest`        | 26     | Export queueing, CSV columns and escaping, status, list, signed download, 409/410, ownership, pruning               |
| `Http/Controllers/FormNotificationControllerTest`       | 18     | Recipient CRUD, `value` by type, read-only `error` / `form_id`, delete/restore, ownership                           |
| `Http/Controllers/FormSubmissionControllerTest`         | 10     | Public submissions: response, honeypot, validation, inactive/deleted form, domains, both rate limits                 |
| `Http/Controllers/AuthControllerTest`                   | 16     | Login, throttle, `me`, logout, deny list, refresh                                                                   |
| `Http/Controllers/AccountControllerTest`                | 11     | Profile, password change and revocation, account deletion                                                           |
| `Http/Controllers/PasswordResetControllerTest`          | 6      | Forgot/reset password, enumeration safety, throttling                                                               |
| `Http/Controllers/PostmarkWebhookControllerTest`        | 5      | Basic auth, bounce and complaint recording, ignored records                                                         |
| `FormEntryAlertsTest`                                   | 11     | Who gets alerted, email content and time formatting, retries and `error`, deleted forms/entries/recipients          |
| `FormEntrySpamCheckTest`                                | 6      | Jev verdicts, threshold, failures, honeypot skip                                                                    |
| `FormEntryUserAgentTest`                                | 5      | `user_agent_display` parsing and the queued listener                                                                |
| `Actions/BuildValidationRulesTest`                      | 3      | Empty schema, array rules, comma-delimited rules                                                                    |
| `Actions/GenerateHoneypotNameTest`                      | 2      | Name format, avoiding taken names                                                                                   |
| `Console/CreateUserCommandTest`                         | 3      | Operator account creation                                                                                           |
| `OpenApiDocumentTest`                                   | 4      | API docs describe `access_token` as a string, `spam_score` as a number, export `parameters` as an object, and schema fields as requiring only `id` and `order`. Port as checks on the `@nestjs/swagger` document. The docs aren't contractual, but clients may generate code from them |

Some tests reach into Laravel internals (`Event::fake`, `Mail::fake`, `Queue::fake`, `Classification::fake`, `Storage::fake`, `RateLimiter`). Replace each with the Nest equivalent from §7.1, and keep the assertion.

## 7.3 New tests the port must add

**Bug fix:**

- F7: saving a form whose schema has an unknown rule (`"requird"`, or the stray `b` from `"in:a,b"` as a string) returns 422 on `schema.N.rules`. A valid schema still saves.

**Quirks (guard rails, see README):**

- An entry with no validated fields has `input: []`. An export with no filters has `parameters: {}`.
- `spam_score` is rounded to 2 decimals on save (`0.456` → `0.46`), serialised as a JSON number, and written to CSV in the same form (`0.25`, not `0.250`).
- Saved `settings` always come back with all six keys, including for a stored row that's missing some.
- PATCH on a form without `active` returns 422. A one-field PATCH on an entry succeeds.
- Sending `input: null` on entry update, or `error: null` on notification create, returns 422.
- Notification list links drop extra query parameters. Form, entry and export list links keep them, with `page` last and brackets percent-encoded.
- An entry or notification of a soft-deleted form returns 403. A soft-deleted form returns 404.
- Lists are oldest first, 15 per page, and `?page=2` works.

**Cross-cutting:**

- Check order: a non-owner sending an invalid body gets 403, not 422. An unknown ID gets 404, not 403.
- Timestamps have six fractional digits on every resource.
- Requests without `Accept: application/json` still get JSON errors.

**Validation behaviour (ch. 4):**

- Unknown submitted fields are dropped from `input`.
- A `sometimes` field that's absent is omitted from `input`; one that's present is validated.
- The multi-error `message` suffix: "(and 1 more error)" vs. "(and 2 more errors)".
- A urlencoded public submission validates `"1"` as boolean and numeric.

**Background work (ch. 6):** the "Done when" items of chapter 6, where `FormEntryAlertsTest`, `FormEntrySpamCheckTest` and `FormEntryUserAgentTest` don't already cover them.

## 7.4 Contract suite: proving parity

`test/contract/*.spec.ts` uses only HTTP. It must not import anything from `src/`.

```bash
# against Laravel
CONTRACT_BASE_URL=http://localhost:8000 CONTRACT_EMAIL=… CONTRACT_PASSWORD=… npm run test:contract
# against NestJS
CONTRACT_BASE_URL=http://localhost:3000 CONTRACT_EMAIL=… CONTRACT_PASSWORD=… npm run test:contract
```

- Seed both databases with the same user (`php artisan user:create` on one side and `npm run user:create` on the other), then create all other data through the API in `beforeAll`. That includes a second user for the ownership cases, and public submissions for entries.
- Tag the F7 case, so the Laravel run expects the old behaviour (save accepted) and the Nest run expects 422.
- Normalise IDs, timestamps, tokens and signed URLs before snapshot comparisons.
- Run both servers with `QUEUE_CONNECTION=sync` / inline processing, no `TYPESAFE_API_KEY`, and a log mailer, so background effects are visible straight after each request.
- For exports, poll `GET /entry-exports/:id` until it's `completed`, then fetch `download_url` and compare the CSV bytes.
- Don't run the rate-limit cases against shared environments. They lock out the test IP for a minute.

Both servers issue tokens through `POST /api/v1/auth/login`. The contract suite logs in with the seeded user in `beforeAll` instead of taking a pre-minted token.

## 7.5 Cut-over checklist

- [ ] Parity matrix is green.
- [ ] §7.3 tests are green.
- [ ] Contract suite is green on both servers, with only the expected F7 difference.
- [ ] Data import rehearsed. Contract suite green against the imported copy.
- [ ] Every rule used by production form schemas is supported (ch. 4 §4.3 SQL check).
- [ ] Laravel queue drained and Laravel scheduler/worker stopped before the final import.
- [ ] Nest worker and scheduler running (exactly one scheduler).
- [ ] `JWT_SECRET` rotated at cut-over; users can log in against the new service.
- [ ] Postmark webhook URL pointed at the new service, with the same basic-auth credentials; a test bounce records an `error`.
- [ ] Browser forms on at least one customer site submit successfully (CORS, domain check, honeypot).
- [ ] Rollback plan: keep the Laravel app deployable against a read-only snapshot for one release cycle.
- [ ] Product owner has signed off F7 and the open decisions in the README.
