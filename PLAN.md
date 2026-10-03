# NestJS Port — Plan & Progress

Tracks the rebuild described in [`docs/prds/README.md`](docs/prds/README.md). Each phase is finished when its chapter's **Done when** list passes. Tick boxes as work lands.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

## Context

- This repo started with only `docs/`. Nothing has been built yet.
- Reference app: `../form-handler-headless-laravel`, HEAD `c3b6fa7`, three commits after the `6a0fb33` the guide was written against. Two of those commits change code: `spam_score` as a 2-decimal float, and a default `active` value on forms. The guide already describes both. Diff `6a0fb33..HEAD` before phase 2 to confirm.
- Pest tests to port: 213 `it()` blocks in 16 files. The counts match the ch. 7 §7.2 matrix (checked 2026-10-03).
- Local tooling: Node 22.19 and Docker are installed. Redis isn't, so run it with `docker run redis` or `docker-compose.yml`.
- Nest 11 runs on **Express 5**. Several defaults need changing (ch. 1 §1.4).

## Decisions

- [x] **Rate limiter design** (2026-10-03). `@nestjs/throttler` + `@nest-lab/throttler-storage-redis` with a `LaravelThrottlerGuard` subclass for the three HTTP limits (ch. 3 §3.2). The login limiter is hand-written on the same `ioredis` connection (ch. 5 §5.4). No `X-RateLimit-*` headers are sent: neither the Next nor the Nuxt client reads them, and both use only the status code and `Retry-After`.
- [x] **F9** (2026-10-03). Public submissions and password reset get separate rate-limit counters, instead of Laravel's shared `sha1('|' . ip)` key.

## Phase 0: Test harness (built alongside phases 1–3)

- [ ] `Clock` / `FakeClock` with `travel(ms)`. No Jest fake timers (ch. 7 §7.1)
- [ ] `createApp()`: in-memory SQLite (`synchronize: true`), fake mail transport, fake `JevClient`, in-memory storage disk, `FakeClock`
- [ ] `createApp({ db: 'postgres' })` variant that applies the migrations, for the CI Postgres run
- [ ] `JobDispatcher` bindings: `SyncJobDispatcher` and `FakeJobDispatcher` (ch. 6 §6.2)
- [ ] `actingAs(user)`: a stub until phase 4, then the real signer with the right `tv`
- [ ] Factories that persist through repositories and set `id` explicitly (ch. 2 §2.1, §2.5)

## Phase 1: Setup and structure (ch. 1)

- [ ] Scaffold Nest 11 with `strict` TypeScript and install the §1.1 packages (no `class-validator`, `ua-parser-js@^1`). Check each package loads under Jest
- [ ] Validated config per concern; fail fast at boot when a required variable is missing, or when `TZ` isn't `UTC` (§1.2)
- [ ] Module folder layout from §1.3, including empty folders
- [ ] `ApiV1Module` mounted with `RouterModule` at `api/v1`, with no global prefix
- [ ] `GET /up` returns 200; `/` redirects to `/docs/api` (check what Laravel does for non-GET methods)
- [ ] Express 5: `query parser` set to `extended`; no direct use of `req.body`
- [ ] `TRUSTED_PROXIES` → `trust proxy` (`*` → `1`, not `true`)
- [ ] CORS via `app.use('/api', cors({ origin: '*', maxAge: 0 }))`
- [ ] Body parsers: JSON (malformed body → `{}`, `BODY_LIMIT`), urlencoded, multipart fields; 413 as JSON
- [ ] JSON errors everywhere, including 404 for unknown routes and 405 with `Allow`
- [ ] Swagger at `/docs/api`, spec JSON at `/docs/api.json`
- [ ] `npm run worker` entrypoint: processors + event listeners, no HTTP
- [ ] `docker-compose.yml` for Redis and Postgres
- [ ] Shared `ioredis` connection provider (throttler storage + login limiter)
- [ ] CI Redis service (the throttle e2e tests need real Redis)
- [ ] ESLint + Prettier with `no-floating-promises` and `no-explicit-any`
- [ ] Scripts: `lint`, `typecheck`, `test`, `test:e2e`, `test:contract`, `migration:generate`, `migration:run`, `seed`, `user:create`, `worker`
- [ ] CI on Node 22: lint, typecheck, tests on SQLite **and** Postgres, `migration:generate --check`
- [ ] `Dockerfile` (app + worker from one image) (§1.7)

**Done when**
- [ ] ch. 1 Done-when list passes (including the Express 5 query check, the proxy IP check, the CI matrix and the Docker build)

## Phase 2: Data model (ch. 2)

- [ ] Review the Laravel diff `6a0fb33..HEAD` for model and migration changes
- [ ] `UlidEntity` / `SoftDeletableUlidEntity`: lowercase ULIDs, `timestamp(0)`, timestamps set from the `Clock`, soft delete as an update
- [ ] Entities: User, PasswordResetToken, DeniedToken, Form, FormEntry, FormNotification, FormEntryExport
- [ ] `spam_score` transformer: rounds to 2 decimals on write, reads back as a number
- [ ] `jsonColumnType()`: `simple-json` on SQLite, `json` (not `jsonb`) on Postgres
- [ ] `withSettingsDefaults()` helper and `orderedSchema()` (stable sort)
- [ ] Route IDs: invalid ULID → 404; case handling follows the production database (open question)
- [ ] Hand-written migrations, one per table, in this order: users → password_reset_tokens → denied_tokens → forms → form_entries → form_notifications → form_entry_exports. Tables stay readable by Laravel
- [ ] Factories with the `active()` / `inactive()` states and `withBasicSchema`
- [ ] Seed: Test User plus 5 forms, 5 entries and 5 notifications

**Done when**
- [ ] ch. 2 Done-when list passes, including the Postgres checks (whole-second UTC timestamps, JSON key order, numeric counts) and the drift check

## Phase 3: Shared HTTP plumbing, validation engine, contract suite (ch. 3 §3.2, ch. 4 engine, ch. 7 §7.4)

- [ ] Script for reproducible Laravel fixture capture (fixed clock, sync queue, seeded through the API) → `test/fixtures/laravel/`
- [ ] Capture golden fixtures: pagination envelopes for 0, 1, 16 and 200 records, error bodies, an `X-Forwarded-For` chain
- [ ] `request-input.ts`: trim, `""` → `null` (password fields skipped), query + body merge, PHP key rewriting
- [ ] Client IP list in Symfony order; `ip()` = first entry
- [ ] Validation engine (`common/validation`): evaluation model, wildcards, dotted names, async DB rules, Laravel message templates, "(and N more error[s])"
- [ ] PHP-generated rule corpus (`test/fixtures/`) and table-driven tests
- [ ] `@Validated(rules)` parameter decorator
- [ ] `LaravelExceptionFilter`: 401/403/404/405/409/410/413/422/429/500 bodies and headers
- [ ] `ThrottlerModule` with the Redis storage; `LaravelThrottlerGuard` (`getTracker`, `generateKey`, `throwThrottlingException`), `blockDuration: 1`, `setHeaders: false`; `@RateLimited()` decorator (ch. 3 §3.2)
- [ ] `paginate.ts`: envelope, exact port of `UrlWindow`, query encoded like PHP RFC3986 with `page` last, `keepQuery` option, invalid `page` → 1
- [ ] `timestamps.ts`: ISO 8601 with six fractional digits
- [ ] `signed-url.ts`: HMAC-SHA256 over the relative URL, `APP_KEY` with `base64:` decoding, constant-time compare
- [ ] Laravel `boolean` coercion helper (`true false 1 0 "1" "0"`)
- [ ] Contract suite skeleton (`test/contract`, HTTP only, JSON compared as parsed values with key order) green against Laravel
- [ ] Unit tests against the golden fixtures

## Phase 4: Authentication and accounts (ch. 5)

- [ ] Token claims compatible with tymon: `iss sub iat nbf exp jti prv tv`; time taken from the `Clock`
- [ ] Token extractor: `Authorization` header (tymon parsing), `?token=`, body `token`
- [ ] `JwtAuthGuard` + `TokenVersionGuard` + `@CurrentUser()`; `iat` in the future rejected
- [ ] Deny list in the `denied_tokens` table: add, check, prune
- [ ] Login with validation, bcrypt, `$2y$` support and cost 12
- [ ] Login limiter: Laravel `RateLimiter` port on Redis (Lua `hit`, timer key), 5 failures per 60 s, key is transliterated `email|ip()`, in-memory `Clock` store for unit tests
- [ ] Refresh (expiry ignored, 7-day window, keeps `iat`/`sub`/`tv`), logout, `GET /me`
- [ ] `PATCH /me`, `PUT /password`, `DELETE /me` (transactional cascade + file cleanup)
- [ ] Password policy: production rules + HIBP, elsewhere 8 characters minimum
- [ ] Forgot/reset password: broker port, enumeration-safe responses, 6/min per IP through the `password` throttler (one counter for both routes)
- [ ] `npm run user:create`
- [ ] Switch `actingAs` to the real signer
- [ ] Port `AuthControllerTest` (16), `AccountControllerTest` (11), `PasswordResetControllerTest` (6), `CreateUserCommandTest` (3)
- [ ] Contract cases for auth, green against Laravel, then Nest

**Done when**
- [ ] All §5.14 tests pass
- [ ] A real `$2y$` hash from Laravel verifies
- [ ] The contract suite authenticates through `/auth/login`
- [ ] All three token sources work

## Phase 5a: Forms (ch. 3 §3.3–3.4, ch. 4 §4.1 and §4.5)

- [ ] `FormOwnershipGuard` for `:form`, `:entry`, `:notification` and `:export`, with a `@WithTrashed()` route decorator; child of a deleted form → 403
- [ ] List (counts cast to numbers, sort, `filter[active]`, `per_page`), create, show, update, delete, restore, duplicate
- [ ] `FormSettings` rules; schema list and item rules (wildcards)
- [ ] Honeypot name: generation before validation, clash check after
- [ ] `buildRules()` and port `BuildValidationRulesTest` (3)
- [ ] F7: unsupported rule names → 422 on `schema.N.rules`
- [ ] Run the §4.3 SQL check against production schemas, including wildcard and file rules
- [ ] Port `FormControllerTest` (41) and `GenerateHoneypotNameTest` (2)
- [ ] Contract cases, with F7 tagged

## Phase 5b: Entries and public submissions (ch. 3 §3.5–3.6, ch. 4)

- [ ] List (sort, filters, `trashed`, `per_page`), show, update (partial; read-only fields must be missing)
- [ ] `CreateFormEntry` service (input from the prepared request, Symfony-ordered `ip`) and the authenticated create
- [ ] Delete, restore, force delete (409)
- [ ] Bulk actions (validation, only changed rows counted, `updated_at` set from the `Clock`)
- [ ] Public submissions: `submissions-ip` and `submissions-form` throttlers (before the form lookup), F9 separate counters, 404 / inactive 403 / domain check 403 / 422 / honeypot / 201; JSON, urlencoded and multipart bodies
- [ ] `mapFormData()`
- [ ] Port `FormEntryControllerTest` (46) and `FormSubmissionControllerTest` (10)
- [ ] Contract cases

## Phase 5c: Notifications, exports (API side) and Postmark webhook (ch. 3 §3.7–3.9)

- [ ] Notifications: CRUD + restore, `value` rules by type, read-only fields, fixed 15 per page with query parameters dropped
- [ ] Port `FormNotificationControllerTest` (18)
- [ ] Exports: queue (202 + `Location`), `Str::slug` port, show, list, signed download (403/404/410/409)
- [ ] Postmark webhook: basic auth, bounce and complaint classification, `error` text, always 204
- [ ] Port `PostmarkWebhookControllerTest` (5)
- [ ] Contract cases

**Done when (all of phase 5)**
- [ ] Every route in §3.1 is implemented, with PUT and PATCH both working
- [ ] ch. 3 Done-when list passes (pagination as parsed JSON with key order, error bodies including 405, input preparation, proxy IPs)
- [ ] Each check-order case (404 → 403 → 422) has a test
- [ ] README quirk tests pass
- [ ] ch. 4 Done-when list passes (rule corpus, wildcards, "(and 2 more errors)" on both endpoints, urlencoded `"1"`, `"requird"` → 422, trimming)

## Phase 6: Events, queues and background work (ch. 6)

- [ ] Event classes, emitted after the service call resolves: `form.created`, `form-entry.created`, `form-entry.submitted`, `form-entry.spam-checked`
- [ ] `BullJobDispatcher`; processors keep their logic in `handle()`, reload rows including soft-deleted ones, and drop the job when the row is missing
- [ ] `QUEUE_DRIVER=sync` runs the full chain inline
- [ ] User-agent parsing (`ua-parser-js` v1) with the mapping onto donatj's names; port `FormEntryUserAgentTest` (5)
- [ ] `JevClient` + spam check; always emits `spam-checked`; port `FormEntrySpamCheckTest` (6)
- [ ] `SendFormEntryAlerts` (in the worker) + `deliver-alert`: 3 attempts, `backoffStrategy` 60 s/300 s on the Worker, `removeOnFail: false`, writes `error`
- [ ] `NewFormEntry` email: subject, PHP date format + timezone abbreviation, HTML and text parts, Postmark metadata
- [ ] Mail transports: postmark / smtp / log
- [ ] `FormEntryAlertsTest` (11)
- [ ] Export processor + CSV writer (column order, value formats, formula escaping, `fputcsv` quoting including on spaces, cursor streaming)
- [ ] Port `FormEntryExportControllerTest` (26)
- [ ] Hourly prune as a BullMQ job scheduler (`upsertJobScheduler`)

**Done when**
- [ ] ch. 6 Done-when list passes (including the single prune run with two workers, and sync mode)
- [ ] CSV output is byte-identical to Laravel's golden fixtures

## Phase 7: Deployment and staging (ch. 1 §1.7)

- [ ] Staging: Postgres, Redis with persistence, private storage disk, secrets
- [ ] Migrations run as a release step
- [ ] Logging and error reporting matching what Laravel uses; request IDs
- [ ] Readiness check (database + Redis) if the platform supports one
- [ ] `TRUSTED_PROXIES` set for the staging proxy chain and checked
- [ ] Public submission end to end on staging (browser form → spam check → alert email → Postmark bounce)

## Phase 8: Acceptance and cut-over (ch. 7)

- [ ] Parity matrix: 213 Pest tests ported, with the same names and counts per file
- [ ] `OpenApiDocumentTest` (4) ported against the swagger document
- [ ] Client types check: Next and Nuxt `api.d.ts` regenerated from the Nest spec, and both clients typecheck (ch. 7 §7.2)
- [ ] §7.3 new tests: F7, F9, rate limiting, quirks, cross-cutting, input preparation, proxies, token sources, validation behaviour, background work
- [ ] Contract suite green against Laravel and Nest (only F7 and F9 differ; `X-RateLimit-*` ignored)
- [ ] `scripts/import-from-laravel.ts` (ch. 2 §2.6), including type conversion and the schema-shape assertion
- [ ] Import rehearsed on a copy of production data; contract suite green against the imported copy
- [ ] Rollback rehearsed: Laravel running against the new Postgres database

### Cut-over checklist (§7.5)
- [ ] Every rule used by production form schemas is supported
- [ ] Write freeze announced; Laravel queue drained; Laravel worker and scheduler stopped
- [ ] Nest worker(s) running, with the prune job scheduler registered
- [ ] `JWT_SECRET` rotated; users can log in
- [ ] `TRUSTED_PROXIES` checked against production's proxy chain, including the Next/Nuxt servers that forward browser IPs
- [ ] Postmark webhook pointed at the new service; a test bounce records an `error`
- [ ] Browser form on a customer site submits successfully (CORS, domain check, honeypot, multipart if used)
- [ ] Rollback: Laravel kept deployable against the new database for one release cycle
- [ ] Product owner has signed off F7, F9, the `X-RateLimit-*` difference and the open decisions

## Risks

1. **Request input preparation.** Laravel trims strings, turns `""` into `null`, merges the query string into the body, parses multipart and rewrites PHP key names before validation. If any step is missed, stored data silently differs. Mitigation: the ch. 3 §3.2 tests in phase 3, and contract cases with whitespace, empty strings and query parameters.
2. **Proxy and IP handling.** Mapping `*` to Express's `true` would let clients fake their IP and get around every rate limit. Express's IP order also differs from Symfony's. Mitigation: map `*` to `1`, port `getClientIps`, and use a captured fixture.
3. **Express 5 defaults.** The `simple` query parser breaks every `filter[...]` parameter. Mitigation: a ch. 1 done-when check.
4. **Exact output.** Pagination `meta.links`, CSV quoting and email time formats (PHP `T` vs `Intl`) are the likely places parity breaks. JSON is compared as parsed values with key order; CSV byte for byte. Mitigation: golden fixtures from Laravel in phase 3.
5. **Rule coverage and PHP behaviour.** Unknown production rules, wildcards, file rules, and edge cases in `email`, `url`, `date`, `numeric` and `timezone`. Mitigation: the §4.3 SQL check before phase 5a ends, and the PHP-generated corpus.
6. **SQLite vs Postgres.** Counts and numerics come back as strings, `jsonb` reorders keys, timestamps and timezones, collation. Mitigation: CI e2e against Postgres, plus the migration drift check.

## Open questions

- [ ] Does production store exports on S3 (`FILESYSTEM_DISK`)? If so, add `@aws-sdk/client-s3`
- [ ] Is a copy of the production database available for the import rehearsal?
- [ ] Which database engine and version does Laravel production use? This drives the import script, case-insensitive route IDs and collation
- [ ] Production PHP limits: `post_max_size` (→ `BODY_LIMIT`) and `max_input_vars` (→ `parameterLimit`)
- [ ] Production `app.timezone`, which the import needs to read stored timestamps
- [x] Does any client authenticate with `?token=` or a body `token`? No: Next and Nuxt both send `Authorization: Bearer` (checked 2026-10-03). Still supported for parity
- [ ] Do any customer forms post `multipart/form-data`, or use `file`/`image` rules?
- [ ] What does Laravel use for logging and error reporting in production?
- [ ] Product owner: should rule names be checked on save (F7)? Default: yes
- [ ] Product owner: keep the owner-only authenticated entry-create endpoint? Default: keep it
- [x] Product owner: copy the shared submission/password-reset rate-limit counter? No: fixed as F9 (2026-10-03)
- [ ] Which timezones are set in production `settings.timezone`? Their abbreviations need checking against PHP's

## Log

- 2026-10-03: Plan created from `docs/prds/README.md`.
- 2026-10-03: Review against the Laravel source (including vendor) added: input preparation (trim, empty → null, query merge, multipart, malformed JSON), Symfony IP order and `*` proxy semantics, Express 5 defaults, tymon token sources, the shared throttle key, JSON parity defined as parsed values with key order, 405 handling, the validation engine for every endpoint (no `class-validator`), `Clock` and `timestamp(0)`, `json` over `jsonb`, Postgres CI and drift check, BullMQ job scheduler and `JobDispatcher`, `ua-parser-js` v1, the deployment phase, and rollback against the new database. Phases reordered: validation engine in phase 3, ownership guard after auth, phase 5 split, contract suite started in phase 3. Rate limiter design left for discussion.
- 2026-10-03: Checked the Next and Nuxt clients. Both generate `api.d.ts` from `/docs/api.json` (the OpenAPI spec is now semi-contractual, with a client typecheck gate), pass the browser's IP on in `X-Forwarded-For`, and read only `Retry-After`. Decided: `@nestjs/throttler` + nest-lab Redis storage with `LaravelThrottlerGuard`, a hand-written login limiter, no `X-RateLimit-*` headers, and F9 (separate submission and password-reset counters).
