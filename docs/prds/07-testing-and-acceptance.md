# 7. Testing & Acceptance

## 7.1 Test layers

| Layer    | Tool             | Runs against                                                                  | Purpose                                                                         |
| -------- | ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unit     | Jest             | Pure functions                                                                | `buildRules`, `SchemaValidator`, `paginate`, presenters, JWT claims, CSV writer, signed URLs, UA mapping |
| E2E      | Jest + Supertest | Nest app booted in-process: SQLite `:memory:` with `synchronize: true` locally, plus a CI run against Postgres with the migrations applied | Port of every Pest feature test                                                 |
| Contract | Jest + `fetch`   | **Any** base URL (`CONTRACT_BASE_URL`, `CONTRACT_EMAIL`, `CONTRACT_PASSWORD`) | Proves parity by running the same suite against Laravel and NestJS              |

E2E helpers to write first:

- `createApp()`: boots `AppModule` with a fresh in-memory DB, an in-memory storage disk, a fake mail transport and a fake `JevClient`.
- **Queue mode:** bind `SyncJobDispatcher` (ch. 6 §6.2), the equivalent of `QUEUE_CONNECTION=sync`. Bind `FakeJobDispatcher` when a test asserts that something was queued but not run (`Queue::fake()`).
- `actingAs(user)`: signs a JWT for the user (with the right `tv`) and returns a Supertest agent with the `Authorization` header set. This is the equivalent of Pest's `actingAs`. It depends on the token service from plan phase 4, so start with a stub and switch it to the real signer when that phase lands.
- `travel(ms)`: moves a `FakeClock` bound in place of the `Clock` (ch. 2 §2.1). It covers refresh windows, throttles, export expiry and pruning (Pest's `$this->travel()`). Don't use Jest's fake timers: they stall better-sqlite3, BullMQ and Supertest, which all depend on real timers and I/O. JWT signing and verification must take their time from the `Clock` as well, so pass explicit `iat`, `nbf` and `exp` and check them yourself against `clock.now()`.
- **Rate limits:** the throttler tests use the real Redis storage, on a Redis service in CI and in `docker-compose` locally, with `FLUSHDB` between tests. The package's in-memory storage counts differently (ch. 3 §3.2), so don't use it. The window runs on Redis's clock, so `travel()` can't move it. Tests that cross a window boundary either use a short TTL set by test config, or delete the counter key. The login limiter can use its in-memory `Clock`-driven store in unit tests (ch. 5 §5.4).
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
| `OpenApiDocumentTest`                                   | 4      | API docs describe `access_token` as a string, `spam_score` as a number, export `parameters` as an object, and schema fields as requiring only `id` and `order`. Port as checks on the `@nestjs/swagger` document served at `/docs/api.json`. See _Client types_ below |

**Client types.** The two known clients, `../form-handler-head-next` and `../form-handler-head-nuxt`, generate their API types from the backend's spec. Each has a `scripts/generate-api-types.mjs` that fetches `{API base minus /api}/docs/api.json` and runs `openapi-typescript`, writing `api.d.ts` and an `openapi.json` copy (`types/` in Next, `shared/types/` in Nuxt). Their own contract suites run against a mock backend that serves that `openapi.json`. The generated files are currently identical in the two clients. So the Nest spec doesn't have to match Scramble's byte for byte, but it must produce **compatible types**. Add a check that:

1. generates `api.d.ts` from the Nest service's `/docs/api.json` with the clients' script;
2. puts it in place of each client's committed file and runs that client's `typecheck`;
3. fails on any type error.

Run it before cut-over and whenever the Nest spec changes. `@nestjs/swagger` needs explicit `@ApiProperty` and response metadata to get there; a Scramble-like inferred spec won't happen on its own.

Some tests reach into Laravel internals (`Event::fake`, `Mail::fake`, `Queue::fake`, `Classification::fake`, `Storage::fake`, `RateLimiter`). Replace each with the Nest equivalent from §7.1, and keep the assertion.

## 7.3 New tests the port must add

**Bug fix:**

- F7: saving a form whose schema has an unknown rule (`"requird"`, or the stray `b` from `"in:a,b"` as a string) returns 422 on `schema.N.rules`. A valid schema still saves.
- F9: after 6 public submissions from one IP within a minute, `POST /auth/forgot-password` from that IP still returns 200. Forgot and reset still share their 6/min counter with each other.

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
- A wrong method on a known path returns 405 with an `Allow` header. An unknown route returns JSON 404.
- `?page=abc`, `?page=0` and `?page=-1` return page 1.
- Input: strings are trimmed, `""` becomes `null` (but `password` fields aren't trimmed), the query string is merged with the body, malformed JSON gets 422, multipart submissions work, and `first name` / `user.email` keys become `first_name` / `user_email` in urlencoded bodies.
- Proxies: with `TRUSTED_PROXIES=*`, the stored `ip` and the rate-limit key follow Symfony's order (ch. 3 §3.5). A faked leftmost `X-Forwarded-For` entry doesn't change the rate-limit key.
- Tokens are accepted from the `Authorization` header, from `?token=` and from a body `token` field.
- Rate limiting (ch. 3 §3.2):
  - 429 carries `Retry-After` equal to the seconds left in the window, and no `X-RateLimit-*` headers;
  - a request over the limit doesn't extend the lockout;
  - the next window accepts requests;
  - unknown form IDs are counted, and the 429 comes before the 404.
- On Postgres: `input` keeps the submitted key order, and the form-list counts are numbers.

**Validation behaviour (ch. 4):**

- Unknown submitted fields are dropped from `input`.
- A `sometimes` field that's absent is omitted from `input`; one that's present is validated.
- The multi-error `message` suffix: "(and 1 more error)" vs. "(and 2 more errors)".
- A urlencoded public submission validates `"1"` as boolean and numeric.

**Background work (ch. 6):** the "Done when" items of chapter 6, where `FormEntryAlertsTest`, `FormEntrySpamCheckTest` and `FormEntryUserAgentTest` don't already cover them.

## 7.4 Contract suite: proving parity

`test/contract/*.spec.ts` uses only HTTP. It must not import anything from `src/`.

**Build it as you go, not at the end.** Start the suite in plan phase 3, and add each endpoint's cases in the phase that builds the endpoint. Run every new case against Laravel **first**: a case that fails there means this guide is wrong, which is cheaper to learn before the Nest code exists. Then run it against Nest.

**Golden fixtures.** For byte-exact items (CSV) and anything the e2e tests compare against, capture output from a reproducible Laravel run:

- a fresh SQLite database;
- a fixed clock (`Carbon::setTestNow()`, through a local-only service provider or a `tinker` script);
- seeded data created through the API;
- `QUEUE_CONNECTION=sync`.

Commit the fixtures, together with the script that produced them, under `test/fixtures/laravel/`.

```bash
# against Laravel
CONTRACT_BASE_URL=http://localhost:8000 CONTRACT_EMAIL=… CONTRACT_PASSWORD=… npm run test:contract
# against NestJS
CONTRACT_BASE_URL=http://localhost:3000 CONTRACT_EMAIL=… CONTRACT_PASSWORD=… npm run test:contract
```

- Seed both databases with the same user (`php artisan user:create` on one side and `npm run user:create` on the other), then create all other data through the API in `beforeAll`. That includes a second user for the ownership cases, and public submissions for entries.
- Tag the F7 case, so the Laravel run expects the old behaviour (save accepted) and the Nest run expects 422.
- Tag the F9 case the same way: 6 submissions followed by a forgot-password request gets 429 from Laravel and 200 from Nest.
- Leave `X-RateLimit-*` headers out of every comparison. The port doesn't send them (ch. 3 §3.2). `Retry-After` on 429 is compared.
- Compare JSON as parsed values **with key order** (for example, compare `Object.entries` recursively), never as raw bytes. Laravel escapes `/` and non-ASCII characters, and Node doesn't (ch. 3 §3.2). Compare CSV downloads byte for byte.
- Normalise IDs, timestamps, tokens and signed URLs before snapshot comparisons. Also normalise floats that are whole numbers (`1.0` vs `1`).
- Run Laravel with `QUEUE_CONNECTION=sync` and Nest with `QUEUE_DRIVER=sync`, both with no `TYPESAFE_API_KEY` and a log mailer, so background effects are visible straight after each request.
- For exports, poll `GET /entry-exports/:id` until it's `completed`, then fetch `download_url` and compare the CSV bytes.
- Don't run the rate-limit cases against shared environments. They lock out the test IP for a minute.

Both servers issue tokens through `POST /api/v1/auth/login`. The contract suite logs in with the seeded user in `beforeAll` instead of taking a pre-minted token.

## 7.5 Cut-over checklist

- [ ] Parity matrix is green.
- [ ] §7.3 tests are green.
- [ ] Contract suite is green on both servers, with only the expected F7 and F9 differences.
- [ ] Data import rehearsed. Contract suite green against the imported copy.
- [ ] Every rule used by production form schemas is supported (ch. 4 §4.3 SQL check).
- [ ] Write freeze for the import window agreed and announced. Laravel's `artisan down` returns 503 to customer browser forms, so keep the window short and schedule it for low traffic.
- [ ] Laravel queue drained and Laravel scheduler/worker stopped before the final import.
- [ ] Nest worker(s) running, with the hourly prune job scheduler registered (ch. 6 §6.7).
- [ ] `TRUSTED_PROXIES` set for the new hosting, and checked: the stored `ip` and the rate-limit key match what Laravel recorded for the same proxy chain.
- [ ] `JWT_SECRET` rotated at cut-over; users can log in against the new service.
- [ ] Postmark webhook URL pointed at the new service, with the same basic-auth credentials; a test bounce records an `error`.
- [ ] Browser forms on at least one customer site submit successfully (CORS, domain check, honeypot).
- [ ] Rollback plan: keep the Laravel app deployable for one release cycle, pointed at the **new** Nest database rather than a read-only snapshot. A snapshot would lose every entry, recipient change and account change made after cut-over. This works because the tables stay readable by Laravel (ch. 2 §2.4). Before relying on it:
  - confirm Laravel's database driver can reach the new Postgres;
  - add the `cache`, `jobs` and `failed_jobs` tables Laravel needs, or point Laravel at Redis for those;
  - rehearse the rollback once.
- [ ] Product owner has signed off F7, F9, the `X-RateLimit-*` header difference and the open decisions in the README.
