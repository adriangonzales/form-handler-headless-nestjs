# 1. Setup & Project Structure

## 1.1 Bootstrap

```bash
npm i -g @nestjs/cli
nest new form-handler-headless-nest --package-manager npm --strict
cd form-handler-headless-nest

npm i @nestjs/typeorm typeorm better-sqlite3 pg ulid \
      validator \
      @nestjs/config @nestjs/event-emitter \
      @nestjs/throttler @nest-lab/throttler-storage-redis ioredis \
      @nestjs/jwt bcrypt \
      @nestjs/bullmq bullmq \
      nodemailer postmark \
      ua-parser-js@^1 csv-stringify \
      @nestjs/swagger
npm i -D @types/bcrypt @types/nodemailer @types/validator @types/ua-parser-js supertest @types/supertest @faker-js/faker
```

- Add `@aws-sdk/client-s3` only if production stores exports on S3 (check `FILESYSTEM_DISK` on the Laravel host).
- Not installed on purpose: `class-validator` and `class-transformer`, because request validation uses the ch. 4 rule engine (README, _Technology choices_). `@nestjs/schedule` isn't installed either: the hourly prune is a BullMQ job scheduler (§1.5).
- Pin `ua-parser-js` to v1. v1 is MIT; v2 is AGPL-3.0.
- `multer`, which parses multipart bodies, already comes with `@nestjs/platform-express`.
- `ioredis` is a peer dependency of the throttler storage. BullMQ uses it too. Create one Redis connection provider and share it between the throttler storage and the login limiter. BullMQ needs its own connections, because blocking workers can't share one.
- Nest compiles to CommonJS, and Jest runs through `ts-jest`. Some current major versions are ESM-only, so check each package loads under Jest before pinning it.

## 1.2 Configuration

Use `@nestjs/config`, with one validated config object per concern. These environment variables replace the Laravel `.env` values:

| Variable                                                  | Laravel equivalent         | Notes                                                                                           |
| --------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `APP_URL`                                                 | `APP_URL`                  | Default base for `PASSWORD_RESET_URL` and for URLs built outside a request. Pagination links, `Location` headers, `download_url` and the JWT `iss` use the request's own scheme and host |
| `APP_ENV`                                                 | `APP_ENV`                  | `production` turns on the strict password policy (ch. 5 §5.9)                                   |
| `APP_KEY`                                                 | `APP_KEY`                  | Signs export download URLs (ch. 3 §3.7)                                                         |
| `DB_TYPE` / `DB_URL`                                      | `DB_CONNECTION` / `DB_*`   | `sqlite` or `postgres`                                                                          |
| `REDIS_URL`                                               | `REDIS_*`                  | BullMQ queues and the rate limiter store                                                        |
| `JWT_SECRET` / `JWT_TTL` / `JWT_REFRESH_TTL`              | same                       | Signing secret; token lifetime (default 60) and refresh window (default 10080), in minutes      |
| `PASSWORD_RESET_URL`                                      | same                       | Client page that reset emails link to. Default `{APP_URL}/reset-password`                       |
| `TRUSTED_PROXIES`                                         | same                       | Comma-separated IPs/CIDRs, or `*`, which trusts only the calling IP. Empty means trust none (§1.4) |
| `QUEUE_DRIVER`                                            | `QUEUE_CONNECTION`         | `bullmq` (default) or `sync`. `sync` runs jobs inline in the request, as `QUEUE_CONNECTION=sync` does. The contract suite runs the server this way (ch. 7 §7.4) |
| `BODY_LIMIT`                                              | PHP `post_max_size`        | Largest request body accepted. Match production's `post_max_size` (PHP default `8M`)            |
| `TZ`                                                      | `app.timezone`             | Must be `UTC`. Fail at boot otherwise (ch. 2 §2.1)                                              |
| `EXPORT_DOWNLOAD_URL_TTL`                                 | same                       | Minutes a signed export `download_url` stays valid. Default 5                                   |
| `FILESYSTEM_DISK` (+ S3 vars if used)                     | same                       | Where export CSVs are written. Must be private                                                  |
| `TYPESAFE_API_KEY`                                        | same                       | Jev spam classification. Empty means skip classification (ch. 6 §6.4)                           |
| `MAIL_MAILER`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `MAIL_*` | same                  | `postmark`, `smtp` or `log`                                                                     |
| `POSTMARK_API_KEY`                                        | same                       | When `MAIL_MAILER=postmark`                                                                     |
| `POSTMARK_WEBHOOK_USERNAME` / `POSTMARK_WEBHOOK_PASSWORD` | same                       | Basic auth for the bounce webhook. If either is empty, the webhook returns 401 (ch. 3 §3.9)     |

Fail fast at boot if a required variable is missing. `TYPESAFE_API_KEY` and the Postmark variables are optional; the features that use them degrade the way chapter 6 describes.

## 1.3 Module layout

Keep the Laravel domain boundaries. Each Laravel directory maps to one place in the Nest app:

```
src/
  main.ts                    # pipes, filters, trust proxy, swagger
  app.module.ts
  config/
  common/
    http/
      laravel-exception.filter.ts   # 401/403/404/405/409/410/422/429 JSON shapes (ch. 3 §3.2)
      request-input.ts              # trim, empty -> null, query+body merge, PHP key mangling (ch. 3 §3.2)
      body-parsers.ts               # JSON (malformed -> {}), urlencoded, multipart fields
      trust-proxy.ts                # TRUSTED_PROXIES -> Express `trust proxy`, Symfony IP order
      paginate.ts                   # Laravel paginator envelope (ch. 3 §3.2)
      signed-url.ts                 # temporary signed routes (ch. 3 §3.7)
      timestamps.ts                 # ISO 8601 with microseconds
    validation/                     # Laravel rule engine + messages, used by DTOs and form schemas (ch. 4)
    clock/                          # injectable Clock (now(), whole seconds); tests travel with it
    queue/                          # JobDispatcher: bullmq / sync / fake (ch. 6 §6.2)
    rate-limit/                     # ThrottlerModule config, LaravelThrottlerGuard (ch. 3 §3.2)
    redis/                          # shared ioredis connection provider
    db/
      ulid-entity.ts                # base class: ULID PK + timestamps + soft delete
      json-column.ts                # `json` on Postgres, `simple-json` on SQLite (ch. 2 §2.3)
    storage/                        # local / S3 disk for export files
  users/                     # User entity, user:create command
  auth/                      # login/refresh/logout/me, guard, deny list, login throttle (ch. 5)
  accounts/                  # PATCH/DELETE /auth/me, PUT /auth/password, password reset (ch. 5)
  forms/                     # FormController, Form entity, FormPolicy, DuplicateForm, honeypot names
    form.entity.ts
    form-settings.ts         # App\Data\FormSettings
    forms.controller.ts
    forms.service.ts
    form-ownership.guard.ts
    rules/                   # request rule arrays (store, update, index)
    schema-rules/            # BuildValidationRules + F7 check (ch. 4); the engine itself is in common/validation
  form-entries/              # FormEntryController, CreateFormEntry, FilterEntries, ApplyBulkAction
  submissions/               # FormSubmissionController (public endpoint)
  entry-exports/             # FormEntryExportController, export job, CSV writer
  form-notifications/        # FormNotificationController, alert listener + job
  spam/                      # Jev client + CheckFormEntryForSpam listener
  user-agents/               # ParseFormEntryUserAgent listener
  mail/                      # transport + NewFormEntry and reset-password messages
  webhooks/                  # Postmark bounce webhook
  events/                    # FormCreated, FormEntryCreated, FormEntrySubmitted, FormEntrySpamChecked
  scheduler/                 # hourly prune of denied tokens and expired exports (BullMQ job scheduler)
  database/
    migrations/
    seeds/
test/
  contract/                  # black-box HTTP tests, runnable against either server
  e2e/                       # Nest app booted in-process against SQLite
```

| Laravel                         | NestJS                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| `app/Models/*`                  | `*.entity.ts`                                                          |
| `app/Http/Controllers/*`        | `*.controller.ts` (thin) + `*.service.ts` (logic)                      |
| `app/Http/Requests/*`           | `rules/*.rules.ts` (Laravel rule arrays run by the ch. 4 engine through a `@Validated(rules)` param decorator), plus guards for `authorize()` |
| `app/Http/Resources/*`          | `*.presenter.ts`: pure functions `toFormResource(form)` etc.           |
| `app/Policies/*`                | Ownership guards + service-level checks                                |
| `app/Actions/*`                 | Injectable services in the matching module                             |
| `app/Data/FormSettings`         | `forms/form-settings.ts`                                               |
| `app/Concerns/*`                | Shared DTO helpers (settings rules, notification `value` rules)        |
| `app/Events/*`                  | Event classes + `EventEmitter2`                                        |
| `app/Listeners/*` (`ShouldQueue`) | `@OnEvent` handlers that enqueue a BullMQ job                        |
| `app/Jobs/*`                    | BullMQ processors                                                      |
| `app/Mail/*`, `resources/views/emails/*` | `mail/` message builders (HTML + text)                         |
| `app/Http/Middleware/*`         | Guards / middleware                                                    |
| `app/Providers/Jwt/DatabaseStorage` | `auth/deny-list.service.ts`                                        |
| `app/Console/Commands/CreateUser` | `npm run user:create` (a standalone Nest application context script) |
| `routes/console.php` schedule   | `scheduler/`: a BullMQ job scheduler registered at worker boot         |
| `database/factories/*`          | `test/factories/*.ts` using `@faker-js/faker`                          |
| `database/seeders/*`            | `src/database/seeds/*.ts` + an `npm run seed` script                   |

## 1.4 `main.ts` essentials

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
app.set('query parser', 'extended'); // Express 5 defaults to 'simple', which breaks filter[read]=1
app.set('trust proxy', trustProxySetting(process.env.TRUSTED_PROXIES)); // false when empty
app.use('/api', cors({ origin: '*', maxAge: 0 })); // ch. 3 §3.1
registerBodyParsers(app, process.env.BODY_LIMIT ?? '8mb'); // JSON, urlencoded, multipart fields
app.use(normaliseRequestInput); // trim + empty -> null, after the parsers (ch. 3 §3.2)
app.useGlobalFilters(new LaravelExceptionFilter());
setupSwagger(app, 'docs/api', { jsonDocumentUrl: 'docs/api.json' }); // clients fetch the JSON (ch. 7 §7.2)
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3000);
```

- **Express 5.** Nest 11 uses Express 5. Three defaults matter here:
  - The query parser is `simple`, so `?filter[read]=1` would arrive as a literal `"filter[read]"` key. Set `'query parser'` to `'extended'`.
  - `req.body` is `undefined` when nothing parsed a body. Read input through the §3.2 helper, never `req.body` directly.
  - Wildcards need a name (`/api/*splat`). Mounting with `app.use('/api', …)` avoids wildcards altogether.
- **Body parsers.** Turn off Nest's built-in parser and register your own (ch. 3 §3.2, _Request input_):
  - `json` with `limit: BODY_LIMIT`. A body that fails to parse becomes `{}`, which then fails validation with 422, as in Laravel, instead of Nest's 400.
  - `urlencoded({ extended: true, limit: BODY_LIMIT, parameterLimit: 1000 })`. `1000` is PHP's `max_input_vars` default; use production's value.
  - `multipart/form-data` text fields through `multer().none()`, or `multer().any()` if production schemas use file rules.
  - Answer bodies over the limit with JSON 413.
- **Trusted proxies.** Map `TRUSTED_PROXIES` onto Express's `trust proxy`:
  - empty → `false`
  - `*` → `1`. Laravel's `*` trusts only the IP that is calling (`setTrustedProxyIpAddressesToTheCallingIp`), which is one hop. Don't map it to `true`: that trusts every hop, so any client could fake `X-Forwarded-For` and get around every per-IP rate limit.
  - otherwise, the list of IPs/CIDRs.

  Forwarded headers then set `req.protocol` and `req.hostname`, which feed absolute URLs. Express's `req.ips` order differs from Symfony's, so build the client IP list with the helper in ch. 3 §3.5, not `req.ips`. Laravel Cloud, Forge and Vapor hosts are trusted automatically in Laravel. If you deploy to one of those, set `TRUSTED_PROXIES` explicitly.
- **Routing.** Don't use `app.setGlobalPrefix('api/v1')` globally, because `GET /up` and `/` live at the root. Put the controllers inside an `ApiV1Module` mounted with `RouterModule.register([{ path: 'api/v1', module: ApiV1Module }])`.
- **Root routes.** `GET /up` returns 200 (Laravel health route). Any method on `/` redirects (302) to the API docs at `/docs/api`.
  Laravel registers `/` in the `web` middleware group, which includes CSRF checks, so `POST /` may answer 419 rather than 302. Check this against the reference app and copy what it does.
- **JSON everywhere.** Every error is JSON, including for requests without `Accept: application/json`. Guests are never redirected. This includes unknown routes (404) and the wrong method on a known route: Laravel returns **405** with an `Allow` header, where Express would return 404 (ch. 3 §3.2).
- **Timezone.** Refuse to boot unless `process.env.TZ === 'UTC'`. The `pg` driver reads `timestamp without time zone` columns in the process's local timezone (ch. 2 §2.1).

## 1.5 Workers and scheduler

The Laravel app needs a queue worker and the scheduler running. The Nest app does too:

- Run BullMQ processors in the same process for dev, and as a separate `npm run worker` process in production (same codebase, different entrypoint). The worker module imports the event listeners as well as the processors, because `check-spam` emits `form-entry.spam-checked` inside the worker and `SendFormEntryAlerts` handles it there (ch. 6 §6.1). It doesn't import the HTTP controllers.
- Register the hourly prune with BullMQ's `queue.upsertJobScheduler('prune', { pattern: '0 * * * *' }, …)` when the worker boots. BullMQ creates only one job per tick, however many workers are running, so there's no "exactly one scheduler" process to manage.
- `QUEUE_DRIVER=sync` runs every job inline in the request and needs no worker or Redis queue (§1.2, ch. 6 §6.2).

## 1.6 Tooling

- ESLint + Prettier (Nest defaults). Add `@typescript-eslint/no-floating-promises` and `no-explicit-any`.
- Scripts: `lint`, `typecheck` (`tsc --noEmit`), `test`, `test:e2e`, `test:contract`, `migration:generate`, `migration:run`, `seed`, `user:create`, `worker`.
- CI: mirror `.github/workflows/tests.yml`, running lint, typecheck and tests on Node 22. Tests need Redis, or an in-memory queue stub (ch. 7 §7.1). Also in CI:
  - A Postgres service container, with the e2e suite run against it as well as against SQLite (ch. 7 §7.1). SQLite hides Postgres differences: counts come back as strings, and sorting depends on collation.
  - `typeorm migration:generate --check` against Postgres, which fails when entities and migrations have drifted apart (ch. 2 §2.4).

## 1.7 Deployment

The definition of done needs a staging environment, so plan for it from the start:

- A `Dockerfile`: a multi-stage build that runs `node dist/main.js`, with the worker using the same image and `node dist/worker.js`.
- Migrations run once per deploy, as a release step (`npm run migration:run`), never on app boot.
- Provision Postgres, Redis (with persistence on, because BullMQ keeps state there), secrets and a private storage disk for staging and for production.
- Logging and error reporting: find out what the Laravel app uses (`config/logging.php`, any Sentry or Flare package) and give the Nest service the same. Use structured JSON logs with a request ID.
- Health: `GET /up` stays a liveness check. Add a readiness check that pings the database and Redis, if the platform supports a second path.

## Done when

- [ ] `npm run start:dev` serves `GET /up` → 200, and `GET /` redirects to `/docs/api`.
- [ ] `npm run worker` starts and connects to Redis.
- [ ] Lint, typecheck and an empty Jest suite pass in CI.
- [ ] The module folders above exist, even if they're empty.
- [ ] `GET /api/v1/forms?filter[read]=1` reaches the handler with `query.filter.read === '1'` (Express 5 query parser).
- [ ] With `TRUSTED_PROXIES=*`, a request carrying `X-Forwarded-For: 1.1.1.1, 2.2.2.2` resolves its client IP to `2.2.2.2`.
- [ ] CI runs against SQLite and Postgres, and runs the migration drift check.
- [ ] The Docker image builds, and the app and the worker both start from it.
