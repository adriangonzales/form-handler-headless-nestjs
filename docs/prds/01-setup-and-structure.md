# 1. Setup & Project Structure

## 1.1 Bootstrap

```bash
npm i -g @nestjs/cli
nest new form-handler-headless-nest --package-manager npm --strict
cd form-handler-headless-nest

npm i @nestjs/typeorm typeorm better-sqlite3 pg ulid \
      class-validator class-transformer validator \
      @nestjs/config @nestjs/event-emitter @nestjs/throttler @nestjs/schedule \
      @nestjs/jwt bcrypt \
      @nestjs/bullmq bullmq \
      nodemailer postmark \
      ua-parser-js csv-stringify \
      @nestjs/swagger
npm i -D @types/bcrypt @types/nodemailer @types/validator supertest @types/supertest @faker-js/faker
```

Add `@aws-sdk/client-s3` only if production stores exports on S3 (check `FILESYSTEM_DISK` on the Laravel host).

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
| `TRUSTED_PROXIES`                                         | same                       | Comma-separated IPs/CIDRs, or `*`. Empty means trust none (§1.4)                                |
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
      laravel-exception.filter.ts   # 401/403/404/409/410/422/429 JSON shapes (ch. 3 §3.2)
      paginate.ts                   # Laravel paginator envelope (ch. 3 §3.2)
      validation-pipe.ts            # class-validator -> Laravel errors
      signed-url.ts                 # temporary signed routes (ch. 3 §3.7)
      timestamps.ts                 # ISO 8601 with microseconds
    db/
      ulid-entity.ts                # base class: ULID PK + timestamps + soft delete
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
    dto/
    schema-rules/            # BuildValidationRules + rule interpreter (ch. 4)
  form-entries/              # FormEntryController, CreateFormEntry, FilterEntries, ApplyBulkAction
  submissions/               # FormSubmissionController (public endpoint)
  entry-exports/             # FormEntryExportController, export job, CSV writer
  form-notifications/        # FormNotificationController, alert listener + job
  spam/                      # Jev client + CheckFormEntryForSpam listener
  user-agents/               # ParseFormEntryUserAgent listener
  mail/                      # transport + NewFormEntry and reset-password messages
  webhooks/                  # Postmark bounce webhook
  events/                    # FormCreated, FormEntryCreated, FormEntrySubmitted, FormEntrySpamChecked
  scheduler/                 # hourly prune of denied tokens and expired exports
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
| `app/Http/Requests/*`           | `dto/*.dto.ts` with `class-validator`, plus guards for `authorize()`   |
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
| `routes/console.php` schedule   | `scheduler/` with `@Cron`                                              |
| `database/factories/*`          | `test/factories/*.ts` using `@faker-js/faker`                          |
| `database/seeders/*`            | `src/database/seeds/*.ts` + an `npm run seed` script                   |

## 1.4 `main.ts` essentials

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.set('trust proxy', trustProxySetting(process.env.TRUSTED_PROXIES)); // false when empty
app.useGlobalFilters(new LaravelExceptionFilter());
app.useGlobalPipes(laravelValidationPipe()); // see ch. 3 §3.2
setupSwagger(app, 'docs/api');
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3000);
```

- **Trusted proxies.** Map `TRUSTED_PROXIES` onto Express's `trust proxy`: empty → `false`, `*` → `true`, otherwise the list of IPs/CIDRs. Forwarded headers then set `req.ip`, `req.ips`, `req.protocol` and `req.hostname`, which feed the stored `ip` and absolute URLs. Laravel Cloud, Forge and Vapor hosts are trusted automatically in Laravel. If you deploy to one of those, set `TRUSTED_PROXIES` explicitly.
- **Routing.** Don't use `app.setGlobalPrefix('api/v1')` globally, because `GET /up` and `/` live at the root. Put the controllers inside an `ApiV1Module` mounted with `RouterModule.register([{ path: 'api/v1', module: ApiV1Module }])`.
- **Root routes.** `GET /up` returns 200 (Laravel health route). Any method on `/` redirects (302) to the API docs at `/docs/api`.
- **JSON everywhere.** Every error is JSON, including for requests without `Accept: application/json`. Guests are never redirected.

## 1.5 Workers and scheduler

The Laravel app needs a queue worker and the scheduler running. The Nest app does too:

- Run BullMQ processors in the same process for dev, and as a separate `npm run worker` process in production (same codebase, different entrypoint).
- Run the scheduler in exactly one process, so the hourly prune doesn't run twice.

## 1.6 Tooling

- ESLint + Prettier (Nest defaults). Add `@typescript-eslint/no-floating-promises` and `no-explicit-any`.
- Scripts: `lint`, `typecheck` (`tsc --noEmit`), `test`, `test:e2e`, `test:contract`, `migration:generate`, `migration:run`, `seed`, `user:create`, `worker`.
- CI: mirror `.github/workflows/tests.yml`, running lint, typecheck and tests on Node 22. Tests need Redis, or an in-memory queue stub (ch. 7 §7.1).

## Done when

- [ ] `npm run start:dev` serves `GET /up` → 200, and `GET /` redirects to `/docs/api`.
- [ ] `npm run worker` starts and connects to Redis.
- [ ] Lint, typecheck and an empty Jest suite pass in CI.
- [ ] The module folders above exist, even if they're empty.
