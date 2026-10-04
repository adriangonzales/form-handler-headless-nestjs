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

- [x] **Rate limiter design** (2026-10-03, storage changed 2026-10-04). `@nestjs/throttler` with a `LaravelThrottlerGuard` subclass for the three HTTP limits (ch. 3 §3.2). The storage is our own Lua port of Laravel's `RateLimiter`: `@nest-lab/throttler-storage-redis` with `blockDuration: 1` let 16,236 of 124,400 burst requests through a 6/min limit. The login limiter is hand-written on the same `ioredis` connection (ch. 5 §5.4). No `X-RateLimit-*` headers are sent: neither the Next nor the Nuxt client reads them, and both use only the status code and `Retry-After`.
- [x] **F9** (2026-10-03). Public submissions and password reset get separate rate-limit counters, instead of Laravel's shared `sha1('|' . ip)` key.

## Phase 0: Test harness (built alongside phases 1–3)

- [x] `Clock` / `FakeClock` with `travel(ms)`. No Jest fake timers (ch. 7 §7.1)
- [~] `createApp()` (`test/support/create-app.ts`): in-memory SQLite (`synchronize: true`) and `FakeClock` done; fake mail transport, fake `JevClient` and in-memory storage disk to add with their phases
- [x] Postgres variant (`DB_TYPE=postgres`): drops the schema and applies the migrations; run with `--runInBand`
- [ ] `JobDispatcher` bindings: `SyncJobDispatcher` and `FakeJobDispatcher` (ch. 6 §6.2)
- [ ] `actingAs(user)`: a stub until phase 4, then the real signer with the right `tv`
- [x] Factories that persist through repositories and set `id` explicitly (ch. 2 §2.1, §2.5), in `src/database/factories/`

## Phase 1: Setup and structure (ch. 1)

- [x] Scaffold Nest 11 with `strict` TypeScript and install the §1.1 packages (no `class-validator`, `ua-parser-js@^1`). Check each package loads under Jest (`test/unit/packages.spec.ts`; Nest-11 majors pinned, see Log)
- [x] Validated config per concern; fail fast at boot when a required variable is missing, or when `TZ` isn't `UTC` (§1.2)
- [x] Module folder layout from §1.3, including empty folders
- [x] `ApiV1Module` mounted with `RouterModule` at `api/v1`, with no global prefix
- [x] `GET /up` returns 200; `/` redirects to `/docs/api` (Laravel: GET/HEAD/OPTIONS → 302, other methods → 419 CSRF; copied)
- [x] Express 5: `query parser` set to `extended`; no direct use of `req.body`
- [x] `TRUSTED_PROXIES` → `trust proxy` (`*` → `1`, not `true`); `getClientIps()` in Symfony order (`common/http/trust-proxy.ts`)
- [x] CORS via `app.use('/api', cors({ origin: '*', maxAge: 0 }))`, echoing the requested method as Laravel does
- [x] Body parsers: JSON (malformed body → `{}`, `BODY_LIMIT`), urlencoded, multipart fields; 413 as JSON
- [x] JSON errors everywhere, including 404 for unknown routes and 405 with `Allow` (Laravel messages and verb order)
- [x] Swagger at `/docs/api`, spec JSON at `/docs/api.json`
- [x] `npm run worker` entrypoint: processors + event listeners, no HTTP (none registered until phase 6)
- [x] `docker-compose.yml` for Redis and Postgres (host ports overridable with `REDIS_HOST_PORT` / `POSTGRES_HOST_PORT`)
- [x] Shared `ioredis` connection provider (throttler storage + login limiter)
- [x] CI Redis service (the throttle e2e tests need real Redis)
- [x] ESLint + Prettier with `no-floating-promises` and `no-explicit-any`
- [x] Scripts: `lint`, `typecheck`, `test`, `test:e2e`, `test:contract`, `migration:generate`, `migration:run`, `seed`, `user:create`, `worker` (`seed` and `user:create` are stubs that exit 1 until phases 2 and 4)
- [x] CI on Node 22: lint, typecheck, tests on SQLite **and** Postgres, `migration:generate --check`
- [x] `Dockerfile` (app + worker from one image) (§1.7)

**Done when**
- [~] ch. 1 Done-when list passes (including the Express 5 query check, the proxy IP check, the CI matrix and the Docker build). Everything was checked locally on 2026-10-03: `start:dev`, the worker on Redis, e2e on SQLite and Postgres, the drift check (passes clean, fails with an unmigrated entity), and the Docker image running app, worker and `migration:run`. Still open: the first green CI run, which needs a push

## Phase 2: Data model (ch. 2)

- [x] Review the Laravel diff `6a0fb33..HEAD` for model and migration changes (only `spam_score` `decimal(3,2)` rounded on set, and the `active` default; both already in the guide)
- [x] `UlidEntity` / `SoftDeletableUlidEntity`: lowercase ULIDs, `timestamp(0)`, timestamps set from the `Clock` (`TimestampSubscriber`), soft delete as an update
- [x] Entities: User, PasswordResetToken, DeniedToken, Form, FormEntry, FormNotification, FormEntryExport
- [x] `spam_score` transformer: rounds to 2 decimals on write (`phpRound`, matching PHP's `round()`), reads back as a number
- [x] `jsonColumnType()`: `simple-json` on SQLite, `json` (not `jsonb`) on Postgres
- [x] `withSettingsDefaults()` helper and `orderedSchema()` (stable sort)
- [~] Route IDs: `isUlid()` (Laravel's `Str::isUlid`) and exact, case-sensitive matching are tested on both databases; the 404 wiring lands with `FormOwnershipGuard` in phase 5a
- [x] Hand-written migrations, one per table, in this order: users → password_reset_tokens → denied_tokens → forms → form_entries → form_notifications → form_entry_exports. Laravel's table, column and constraint names
- [x] Factories with the `active()` / `inactive()` states and `withBasicSchema`
- [x] Seed: Test User plus 5 forms, 5 entries and 5 notifications

**Done when**
- [x] ch. 2 Done-when list passes, including the Postgres checks (whole-second UTC timestamps, JSON key order, numeric counts) and the drift check. Checked locally 2026-10-03: migrations run and revert on SQLite and Postgres, 44 e2e tests pass on both, the Postgres drift check is clean, and `npm run seed` works. The CI run is still pending

## Phase 3: Shared HTTP plumbing, validation engine, contract suite (ch. 3 §3.2, ch. 4 engine, ch. 7 §7.4)

- [x] Script for reproducible Laravel fixture capture (fixed clock, sync queue, seeded through the API) → `test/fixtures/laravel/` (`npm run fixtures:capture`; deterministic, tokens redacted)
- [x] Capture golden fixtures: pagination envelopes for 0, 1, 16 and 200 records (75 cases from Laravel's own paginator), error bodies, an `X-Forwarded-For` chain (`"2.2.2.2,1.1.1.1"`), signed URLs
- [x] `request-input.ts`: trim (`Str::trim`), `""` → `null` (passwords aren't trimmed but still become null, per Laravel's source), query + body merge, PHP key rewriting (`php-input.ts`, a port of `php_register_variable`), `_method` override
- [x] Client IP list in Symfony order; `ip()` = first entry (phase 1; confirmed by the captured fixture)
- [x] Validation engine (`common/validation`): evaluation model, wildcards, dotted names, async rule objects (DB rules), Laravel message templates (exported from PHP), "(and N more error[s])"
- [x] PHP-generated rule corpus (`test/fixtures/validation/`) and table-driven tests: 5,148 single-rule cases + 54 scenarios, all matching
- [x] `@Validated({ rules, prepare?, after? })` parameter decorator
- [x] `LaravelExceptionFilter`: 401/403/404/405/409/410/413/422/429/500 bodies and headers
- [x] Throttling with `LaravelThrottlerGuard` (`getTracker`, `generateKey`, `throwThrottlingException`), `setHeaders: false`, `@RateLimited()`; storage replaced by a Laravel-exact Lua port (see Decisions)
- [x] `paginate.ts`: envelope, exact port of `UrlWindow`, query encoded like PHP RFC3986 with `page` last, `keepQuery` option, invalid `page` → 1
- [x] `timestamps.ts`: ISO 8601 with six fractional digits
- [x] `signed-url.ts`: HMAC-SHA256 over the relative URL, `APP_KEY` **raw** (Laravel doesn't decode `base64:` for signing), constant-time compare
- [x] Laravel `boolean` coercion helper (`true false 1 0 "1" "0"`)
- [x] Contract suite skeleton (`test/contract`, HTTP only, JSON compared as parsed values with key order) green against Laravel (12/12) and against Nest for the built features (9/9, auth cases skipped until phase 4)
- [x] Unit tests against the golden fixtures

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
- [ ] JSON logs to stdout with request IDs (Laravel only writes a local log file; no error reporting to match)
- [ ] Readiness check (database + Redis) if the platform supports one
- [ ] `TRUSTED_PROXIES` set for the staging proxy chain and checked
- [ ] Public submission end to end on staging (browser form → spam check → alert email → Postmark bounce)

## Phase 8: Acceptance and cut-over (ch. 7)

- [ ] Parity matrix: 213 Pest tests ported, with the same names and counts per file
- [ ] `OpenApiDocumentTest` (4) ported against the swagger document
- [ ] Client types check: Next and Nuxt `api.d.ts` regenerated from the Nest spec, and both clients typecheck (ch. 7 §7.2)
- [ ] §7.3 new tests: F7, F9, rate limiting, quirks, cross-cutting, input preparation, proxies, token sources, validation behaviour, background work
- [ ] Contract suite green against Laravel and Nest (only F7 and F9 differ; `X-RateLimit-*` ignored)
- [ ] Fresh-deploy check on staging: migrations on an empty database, `user:create`, create a form, submit to it (no data import, ch. 2 §2.6)

### Cut-over checklist (§7.5)
- [ ] Laravel worker and scheduler stopped at the switch
- [ ] Nest worker(s) running, with the prune job scheduler registered
- [ ] `JWT_SECRET` rotated; users can log in
- [ ] `TRUSTED_PROXIES` checked against production's proxy chain, including the Next/Nuxt servers that forward browser IPs
- [ ] Postmark webhook pointed at the new service; a test bounce records an `error`
- [ ] Browser forms on a customer site submit successfully (CORS, domain check, honeypot), including a multipart form
- [ ] Rollback: Laravel and its SQLite file kept deployable for one release cycle; switch traffic back if needed
- [ ] Product owner has signed off F7, F9, the `X-RateLimit-*` difference and the open decisions

## Risks

1. **Request input preparation.** Laravel trims strings, turns `""` into `null`, merges the query string into the body, parses multipart and rewrites PHP key names before validation. If any step is missed, stored data silently differs. Mitigation: the ch. 3 §3.2 tests in phase 3, and contract cases with whitespace, empty strings and query parameters.
2. **Proxy and IP handling.** Mapping `*` to Express's `true` would let clients fake their IP and get around every rate limit. Express's IP order also differs from Symfony's. Mitigation: map `*` to `1`, port `getClientIps`, and use a captured fixture.
3. **Express 5 defaults.** The `simple` query parser breaks every `filter[...]` parameter. Mitigation: a ch. 1 done-when check.
4. **Exact output.** Pagination `meta.links`, CSV quoting and email time formats (PHP `T` vs `Intl`) are the likely places parity breaks. JSON is compared as parsed values with key order; CSV byte for byte. Mitigation: golden fixtures from Laravel in phase 3.
5. **Rule coverage and PHP behaviour.** There's no production data, so no existing rules need covering. The risk is edge cases in `email`, `url`, `date`, `numeric` and `timezone`. Mitigation: the PHP-generated corpus.
6. **SQLite vs Postgres.** Production Laravel is on SQLite, and Nest moves to Postgres. Counts and numerics come back as strings, `jsonb` reorders keys, timestamps and timezones, and `lower(name)` sorting needs `COLLATE "C"`. Mitigation: CI e2e against Postgres, plus the migration drift check.

## Open questions

- [ ] Product owner: should rule names be checked on save (F7)? Default: yes
- [ ] Product owner: keep the owner-only authenticated entry-create endpoint? Default: keep it

### Answered

- [x] Real production data? None. The supplied dump is seed data, so there's no import or rehearsal, and the service starts empty (2026-10-03)
- [x] `TRUSTED_PROXIES=127.0.0.1` on Laravel now: yes (2026-10-03). Same value for Nest
- [x] Multipart customer forms: required (2026-10-03). File parts are ignored
- [x] Exports storage: `FILESYSTEM_DISK=local` (`storage/app/private`). No S3 client (2026-10-03)
- [x] Production database: SQLite 3.51, UTF-8, default `BINARY` collation, so route IDs are case-sensitive (2026-10-03)
- [x] PHP limits: `post_max_size = 2M` → `BODY_LIMIT=2mb`; `max_input_vars = 1000` → `parameterLimit: 1000` (2026-10-03)
- [x] `app.timezone`: `UTC`, hard-coded in `config/app.php` (2026-10-03)
- [x] Logging: Laravel's `single` file log only, with no error-reporting service (2026-10-03)
- [x] `settings.timezone` in use: none; every value is `null` (2026-10-03)
- [x] `TRUSTED_PROXIES`: empty in production; the front end runs on `localhost:3000` on the same host (2026-10-03). Nest defaults to `PORT=8000`
- [x] Does any client authenticate with `?token=` or a body `token`? No: Next and Nuxt both send `Authorization: Bearer` (2026-10-03). Still supported for parity
- [x] Product owner: copy the shared submission/password-reset rate-limit counter? No: fixed as F9 (2026-10-03)

## Log

- 2026-10-03: Plan created from `docs/prds/README.md`.
- 2026-10-03: Review against the Laravel source (including vendor) added: input preparation (trim, empty → null, query merge, multipart, malformed JSON), Symfony IP order and `*` proxy semantics, Express 5 defaults, tymon token sources, the shared throttle key, JSON parity defined as parsed values with key order, 405 handling, the validation engine for every endpoint (no `class-validator`), `Clock` and `timestamp(0)`, `json` over `jsonb`, Postgres CI and drift check, BullMQ job scheduler and `JobDispatcher`, `ua-parser-js` v1, the deployment phase, and rollback against the new database. Phases reordered: validation engine in phase 3, ownership guard after auth, phase 5 split, contract suite started in phase 3. Rate limiter design left for discussion.
- 2026-10-03: Checked the Next and Nuxt clients. Both generate `api.d.ts` from `/docs/api.json` (the OpenAPI spec is now semi-contractual, with a client typecheck gate), pass the browser's IP on in `X-Forwarded-For`, and read only `Retry-After`. Decided: `@nestjs/throttler` + nest-lab Redis storage with `LaravelThrottlerGuard`, a hand-written login limiter, no `X-RateLimit-*` headers, and F9 (separate submission and password-reset counters).
- 2026-10-03: Production facts recorded: SQLite 3.51 (`BINARY` collation), local disk, `post_max_size` 2M, UTC, file logging only, no form timezones, empty `TRUSTED_PROXIES` with the front end on localhost:3000. The supplied dump appears to be seed data. Docs updated: case-sensitive route IDs, SQLite import, `COLLATE "C"` name sort, `BODY_LIMIT` 2mb, `PORT` 8000, no S3, rollback needs `pdo_pgsql`, `TRUSTED_PROXIES=127.0.0.1` recommended.
- 2026-10-03: No real production data, so the import script, rehearsal, write freeze and queue drain are dropped, and rollback simplified. `TRUSTED_PROXIES=127.0.0.1` decided for Laravel and Nest. Multipart confirmed as a requirement.
- 2026-10-03: Phase 1 scaffolded. Nest 12 has shipped, and the latest `@nestjs/*` majors need it or are ESM-only (Jest can't load them). `@nest-lab/throttler-storage-redis` doesn't support Nest 12, so we pinned Nest 11 lines: `config@4`, `event-emitter@3`, `jwt@11`, `typeorm@11`, `bullmq@11`, `swagger@11`, plus `typeorm@0.3` (unpinned resolves to 1.x) and `faker@9` (10 is ESM-only). `bcrypt@6` rejects `$2y$` hashes, so phase 4 must rewrite them to `$2b$`; checked against a real PHP hash. Laravel root routes probed: non-GET `/` → 419 CSRF; 404/405 messages copied.
- 2026-10-03: Phase 2 done, plus the phase 0 `Clock`, `createApp()` and factories. Findings: (1) entity decorators read `DB_TYPE` at import, before `ConfigModule` loads `.env`, so every entrypoint now imports `config/load-env.ts` first. (2) Jest `setupFiles` can't set the process timezone (the sandbox `process.env` is a copy); the Postgres tests had been running in local time. `TZ=UTC` is now set in a Jest `globalSetup`, with a test that checks it. (3) A TypeORM column transformer on a timestamp or JSON-string column makes every `save()` look like a change, which would bump `updated_at`. Truncation moved into `TimestampSubscriber`, and `user_agent_display` is `simple-json` (`text` on Postgres, a deviation from Laravel's `varchar(255)`). (4) PHP's `round()` differs from `Math.round(x*100)/100` (`0.285` → `0.29`), so `phpRound` is ported and tested against PHP output. (5) The TypeORM SQLite driver has no `char` type, and its schema diff reports false rebuilds, so the drift check stays Postgres-only. Factories moved to `src/database/factories/`.
- 2026-10-04: Phase 3 done. All behaviour is checked against PHP output (messages, timezones, a 5,148-case validation corpus, `parse_str()`, `Str::trim`, 75 paginator envelopes, signed URLs) or the running reference app. Guide corrections: separators in `meta.links` have no `page` key; 413 says "The POST data is too large."; 500 says "Server Error" (no period); signed URLs use the raw `APP_KEY`; empty passwords still become `null`; Laravel's `date` rule rejects relative dates. New parity items: the `_method` override, form bodies parsed only for POST/PUT/PATCH/DELETE, PHP's variable parsing. Bugs found: nest-lab's throttler script reopens the window under bursts (replaced); an early 413 made clients fail with EPIPE (body now drained); Herd's PHP on port 8001 had made a contract run test the wrong server (the runner now refuses busy ports, and Nest uses 8011).
