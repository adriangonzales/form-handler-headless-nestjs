# NestJS Port — Plan & Progress

Tracks the rebuild described in [`docs/prds/README.md`](docs/prds/README.md). Each phase is finished when its chapter's **Done when** list passes. Tick boxes as work lands.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

## Context

- This repo started with only `docs/`. Nothing has been built yet.
- Reference app: `../form-handler-headless-laravel`, HEAD `c3b6fa7`, three commits after the `6a0fb33` the guide was written against. Two of those commits change code: `spam_score` as a 2-decimal float, and a default `active` value on forms. The guide already describes both. Diff `6a0fb33..HEAD` before phase 2 to confirm.
- Pest tests to port: 213 `it()` blocks in 16 files. The counts match the ch. 7 §7.2 matrix.
- Local tooling: Node 22.19 and Docker are installed. Redis isn't, so run it with `docker run redis` or `docker-compose.yml`.

## Phase 0: Test harness (prep for ch. 7, built alongside phase 1)

- [ ] `createApp()`: in-memory SQLite (`synchronize: true`), fake mail transport, fake `JevClient`, in-memory storage disk
- [ ] Queue mode: run jobs inline (like `QUEUE_CONNECTION=sync`), plus `Queue.fake()`-style capture
- [ ] `actingAs(user)`: signs a JWT with the right `tv` and returns a Supertest agent
- [ ] `travel(ms)`: fake timers or an injectable clock
- [ ] Factories that persist through repositories (ch. 2 §2.5)

## Phase 1: Setup and structure (ch. 1)

- [ ] Scaffold Nest 11 with `strict` TypeScript and install the §1.1 packages
- [ ] Validated config per concern; fail fast at boot when a required variable is missing (§1.2)
- [ ] Module folder layout from §1.3, including empty folders
- [ ] `ApiV1Module` mounted with `RouterModule` at `api/v1`, with no global prefix
- [ ] `GET /up` returns 200; any method on `/` returns 302 to `/docs/api`
- [ ] Map `TRUSTED_PROXIES` onto Express `trust proxy`
- [ ] CORS on `/api/*`: any origin, OPTIONS answered with 204
- [ ] Express `urlencoded({ extended: true })` parser
- [ ] JSON errors everywhere, including requests without `Accept: application/json`
- [ ] Swagger at `/docs/api`
- [ ] `npm run worker` entrypoint that connects to Redis
- [ ] `docker-compose.yml` for Redis (and Postgres)
- [ ] ESLint + Prettier with `no-floating-promises` and `no-explicit-any`
- [ ] Scripts: `lint`, `typecheck`, `test`, `test:e2e`, `test:contract`, `migration:generate`, `migration:run`, `seed`, `user:create`, `worker`
- [ ] CI workflow on Node 22: lint, typecheck, tests

**Done when**
- [ ] `npm run start:dev` serves `GET /up` → 200, and `GET /` redirects to `/docs/api`
- [ ] `npm run worker` starts and connects to Redis
- [ ] Lint, typecheck and an empty Jest suite pass in CI
- [ ] The module folders exist

## Phase 2: Data model (ch. 2)

- [ ] Review the Laravel diff `6a0fb33..HEAD` for model and migration changes
- [ ] `UlidEntity` / `SoftDeletableUlidEntity` with lowercase ULIDs
- [ ] Entities: User, PasswordResetToken, DeniedToken, Form, FormEntry, FormNotification, FormEntryExport
- [ ] `spam_score` transformer: rounds to 2 decimals on write, reads back as a number
- [ ] `simple-json` on SQLite, `jsonb` on Postgres
- [ ] `withSettingsDefaults()` helper and `orderedSchema()` (stable sort)
- [ ] Route IDs matched case-insensitively
- [ ] Hand-written migrations, one per table, in this order: users → password_reset_tokens → denied_tokens → forms → form_entries → form_notifications → form_entry_exports
- [ ] Factories with the `active()` / `inactive()` states and `withBasicSchema`
- [ ] Seed: Test User plus 5 forms, 5 entries and 5 notifications

**Done when**
- [ ] Migrations run and revert cleanly on SQLite and Postgres
- [ ] Entity unit tests prove: ULIDs are assigned and lowercase, soft-deleted rows are hidden, `enabled` defaults to `true`, `0.456` is stored as `0.46` and reads back as a number, and `orderedSchema()` sorts stably
- [ ] `npm run seed` produces the seed data

## Phase 3: Shared HTTP plumbing (ch. 3 §3.2–3.3)

- [ ] Capture golden fixtures from the Laravel app: pagination envelopes for 0, 1, 16 and 200 records, and error bodies
- [ ] `LaravelExceptionFilter`: 401/403/404/409/410/422/429/500 bodies
- [ ] `LaravelValidationPipe` + a shared formatter: dot-notation keys, "(and N more error[s])" suffix, English templates
- [ ] `paginate.ts`: envelope, exact port of `UrlWindow`, query encoded like PHP RFC3986 with `page` last, `keepQuery` option
- [ ] `timestamps.ts`: ISO 8601 with six fractional digits
- [ ] `signed-url.ts`: HMAC-SHA256 over the relative URL, `APP_KEY` with `base64:` decoding, constant-time compare
- [ ] `FormOwnershipGuard` for `:form`, `:entry`, `:notification` and `:export`; child of a deleted form → 403
- [ ] Laravel `boolean` coercion helper (`true false 1 0 "1" "0"`)
- [ ] Unit tests against the golden fixtures

## Phase 4: Authentication and accounts (ch. 5)

- [ ] Token claims compatible with tymon: `iss sub iat nbf exp jti prv tv`
- [ ] `JwtAuthGuard` + `TokenVersionGuard` + `@CurrentUser()`
- [ ] Deny list in the `denied_tokens` table: add, check, prune
- [ ] Login with validation, bcrypt, `$2y$` support and cost 12
- [ ] Hand-rolled login throttle on Redis: 5 failures per 60 s, key is transliterated `email|ip`
- [ ] Refresh (expiry ignored, 7-day window, keeps `iat`/`sub`/`tv`), logout, `GET /me`
- [ ] `PATCH /me`, `PUT /password`, `DELETE /me` (transactional cascade + file cleanup)
- [ ] Password policy: production rules + HIBP, elsewhere 8 characters minimum
- [ ] Forgot/reset password: broker port, enumeration-safe responses, 6/min per IP
- [ ] `npm run user:create`
- [ ] Port `AuthControllerTest` (16), `AccountControllerTest` (11), `PasswordResetControllerTest` (6), `CreateUserCommandTest` (3)

**Done when**
- [ ] All §5.14 tests pass
- [ ] A real `$2y$` hash from Laravel verifies
- [ ] The contract suite authenticates through `/auth/login`

## Phase 5: Endpoints and dynamic validation (ch. 3 §3.4–3.9, ch. 4)

### Forms (§3.4)
- [ ] List (counts, sort, `filter[active]`, `per_page`), create, show, update, delete, restore, duplicate
- [ ] `FormSettings` validation; schema list and item validation
- [ ] Honeypot name: generation before validation, clash check after
- [ ] Port `FormControllerTest` (41) and `GenerateHoneypotNameTest` (2)

### Dynamic validation (ch. 4)
- [ ] `buildRules()` and port `BuildValidationRulesTest` (3)
- [ ] `SchemaValidator` evaluation model: `sometimes`, `nullable`, `required`, `bail`, absent attributes
- [ ] Rule set from §4.3, with size handling by type and urlencoded string forms
- [ ] Dotted attribute names (wildcards only if production uses them)
- [ ] Run the §4.3 SQL check against production schemas
- [ ] F7: unsupported rule names → 422 on `schema.N.rules`
- [ ] `mapFormData()`

### Entries (§3.5)
- [ ] List (sort, filters, `trashed`, `per_page`), show, update (partial; read-only fields must be missing)
- [ ] `CreateFormEntry` service and the authenticated create
- [ ] Delete, restore, force delete (409)
- [ ] Bulk actions (validation, only changed rows counted, `updated_at` set)
- [ ] Port `FormEntryControllerTest` (46)

### Public submissions (§3.6)
- [ ] Two rate limits: 300/min per IP, 60/min per form+IP
- [ ] 404 / inactive 403 / domain check 403 / 422 / honeypot / 201 response
- [ ] Port `FormSubmissionControllerTest` (10)

### Notifications (§3.8)
- [ ] CRUD + restore, `value` rules by type, read-only fields, fixed 15 per page with query parameters dropped
- [ ] Port `FormNotificationControllerTest` (18)

### Exports, API side (§3.7)
- [ ] Queue (202 + `Location`), `Str::slug` port, show, list, signed download (403/404/410/409)

### Postmark webhook (§3.9)
- [ ] Basic auth, bounce and complaint classification, `error` text, always 204
- [ ] Port `PostmarkWebhookControllerTest` (5)

**Done when**
- [ ] Every route in §3.1 is implemented, with PUT and PATCH both working
- [ ] The pagination envelope matches Laravel byte for byte
- [ ] The 401/403/404/409/410/422/429 bodies match
- [ ] Each check-order case (404 → 403 → 422) has a test
- [ ] README quirk tests pass
- [ ] ch. 4 Done-when list passes (rule table test, "(and 2 more errors)" on both endpoints, urlencoded `"1"`, `"requird"` → 422)

## Phase 6: Events, queues and background work (ch. 6)

- [ ] Event classes, emitted after commit: `form.created`, `form-entry.created`, `form-entry.submitted`, `form-entry.spam-checked`
- [ ] BullMQ queues; processors reload rows including soft-deleted ones, and drop the job when the row is missing
- [ ] User-agent parsing with the mapping onto donatj's names; port `FormEntryUserAgentTest` (5)
- [ ] `JevClient` + spam check; always emits `spam-checked`; port `FormEntrySpamCheckTest` (6)
- [ ] `SendFormEntryAlerts` + `deliver-alert`: 3 attempts, 60 s/300 s backoff, `removeOnFail: false`, writes `error`
- [ ] `NewFormEntry` email: subject, PHP date format + timezone abbreviation, HTML and text parts, Postmark metadata
- [ ] Mail transports: postmark / smtp / log
- [ ] `FormEntryAlertsTest` (11)
- [ ] Export processor + CSV writer (column order, value formats, formula escaping, `fputcsv` quoting including on spaces, cursor streaming)
- [ ] Port `FormEntryExportControllerTest` (26)
- [ ] Hourly prune of the deny list and expired exports

**Done when**
- [ ] All four events are emitted with the right payload, only on the right endpoints
- [ ] Jev faked: 0.95 flags, 0.5 doesn't, an error leaves the entry unchecked, a honeypot hit skips the call, alerts always follow
- [ ] Alerts go only to enabled, non-deleted email recipients of non-spam public submissions; retry and `error` handling work
- [ ] Email subject, time formatting and field list match `FormEntryAlertsTest`
- [ ] CSV output is byte-identical to Laravel's for the test fixtures
- [ ] Pruning removes expired deny-list rows, exports and their files

## Phase 7: Testing and acceptance (ch. 7)

- [ ] Parity matrix: 213 Pest tests ported, with the same names and counts per file
- [ ] `OpenApiDocumentTest` (4) ported against the swagger document
- [ ] §7.3 new tests: F7, quirks, cross-cutting, validation behaviour, background work
- [ ] Contract suite (`test/contract`, HTTP only, nothing imported from `src/`), with F7 tagged
- [ ] Contract suite green against Laravel
- [ ] Contract suite green against Nest
- [ ] `scripts/import-from-laravel.ts` (ch. 2 §2.6), including the schema-shape assertion
- [ ] Import rehearsed on a copy of production data; contract suite green against the imported copy

### Cut-over checklist (§7.5)
- [ ] Every rule used by production form schemas is supported
- [ ] Laravel queue drained; Laravel worker and scheduler stopped
- [ ] Nest worker running, with exactly one scheduler
- [ ] `JWT_SECRET` rotated; users can log in
- [ ] Postmark webhook pointed at the new service; a test bounce records an `error`
- [ ] Browser form on a customer site submits successfully (CORS, domain check, honeypot)
- [ ] Rollback: Laravel kept deployable against a read-only snapshot for one release cycle
- [ ] Product owner has signed off F7 and the open decisions

## Risks

1. **Byte-exact output.** Pagination `meta.links`, CSV quoting and email time formats (PHP `T` vs `Intl`) are the likely places parity breaks. Mitigation: golden fixtures from Laravel in phase 3.
2. **Rule coverage.** Unknown production rules, or wildcards. Mitigation: run the §4.3 SQL check before phase 5 ends.

## Open questions

- [ ] Does production store exports on S3 (`FILESYSTEM_DISK`)? If so, add `@aws-sdk/client-s3`
- [ ] Is a copy of the production database available for the import rehearsal?
- [ ] Product owner: should rule names be checked on save (F7)? Default: yes
- [ ] Product owner: keep the owner-only authenticated entry-create endpoint? Default: keep it
- [ ] Which timezones are set in production `settings.timezone`? Their abbreviations need checking against PHP's

## Log

- 2026-10-03: Plan created from `docs/prds/README.md`.
