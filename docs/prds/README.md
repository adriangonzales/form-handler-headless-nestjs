# Rebuilding the Form Handler in TypeScript + NestJS

This guide is a hand-off brief for a developer rebuilding the Headless Form Handler (currently Laravel 13 / PHP) as a NestJS application. Read it alongside the product requirements in [`product/`](product/README.md), which describe _what_ the system does. This guide covers _how_ to rebuild it and _what must stay the same_.

It reflects the Laravel app as of 2026-10-02 (commit `6a0fb33`). If the Laravel app has moved on, diff the PRDs since that commit before starting.

## The goal in one sentence

Ship a NestJS service that existing API clients cannot tell apart from the Laravel one, apart from the listed bug fix. It must use the same routes, the same JSON shapes, the same status codes, the same validation behaviour and the same side effects (alert emails, spam checks, exports).

## How to use this guide

Work through the chapters in order. Each one ends with a **Done when** checklist, so don't start the next chapter until that list passes.

| #   | Chapter                                                      | Outcome                                                                 |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1   | [Setup & project structure](01-setup-and-structure.md)       | Running Nest app, config, lint/test tooling, module layout              |
| 2   | [Data model](02-data-model.md)                               | Entities, migrations, ULIDs, soft deletes, factories (no data import needed) |
| 3   | [API contract](03-api-contract.md)                           | Every `/api/v1` endpoint with byte-compatible responses                 |
| 4   | [Dynamic schema validation](04-dynamic-validation.md)        | Laravel-rule interpreter for form submissions                           |
| 5   | [Authentication & accounts](05-authentication.md)            | JWT login/refresh/logout, revocation, account management, password reset |
| 6   | [Events, queues & background work](06-events-and-notifications.md) | Spam checks, user-agent parsing, alert emails, exports, pruning, webhooks |
| 7   | [Testing & acceptance](07-testing-and-acceptance.md)         | Ported test suite and parity sign-off                                   |

## Scope

**Scope: API parity.** Chapters 1 to 7. When done, anything that talks to `/api/v1` today, including browser forms posting to the public submission endpoint and Postmark's bounce webhook, can be pointed at the new service. The Laravel app is headless, so there is no web UI to port.

**Out of scope.** Don't build anything listed under _Gaps_ in the PRDs as part of the port: SMS delivery, CAPTCHA, IP geolocation (`ip_location_display`), email verification, multi-factor auth, "log out everywhere", token scopes. Port first, then extend. If the product owner wants one of those, it becomes separate work after parity sign-off.

## Technology choices

These are decided. Don't substitute alternatives without agreement.

| Concern                 | Laravel today                                               | NestJS rebuild                                                                     |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Runtime                 | PHP 8.4                                                     | Node.js 22 LTS, TypeScript `strict: true`                                          |
| Framework               | Laravel 13                                                  | NestJS 11 on the Express adapter                                                   |
| ORM / migrations        | Eloquent                                                    | TypeORM 0.3, with migrations (no `synchronize` outside tests)                      |
| Database                | SQLite (dev), any SQL in prod                               | SQLite for dev/test, PostgreSQL for production                                     |
| IDs                     | `HasUlids`                                                  | `ulid` package, stored lowercase as `char(26)`                                     |
| Request validation      | Form Requests                                               | The ch. 4 Laravel-rule engine, driven by per-endpoint rule arrays (no `class-validator`) |
| Form settings           | `spatie/laravel-data` (`App\Data\FormSettings`)             | A `FormSettings` class: defaults + validation in one place (ch. 3 §3.4)            |
| Submission validation   | Laravel validator driven by `forms.schema`                  | Custom rule interpreter (ch. 4)                                                    |
| API auth                | `tymon/jwt-auth` (HS256), deny list in `denied_tokens` table | `@nestjs/jwt` + a custom guard, deny list in the same table (ch. 5)               |
| Password hashing        | bcrypt                                                      | `bcrypt` (reads Laravel's `$2y$` hashes, see ch. 5)                                |
| Rate limiting           | `throttle` middleware, `RateLimiter`                        | `@nestjs/throttler` with a Laravel-semantics Redis storage and a `LaravelThrottlerGuard` subclass; a hand-written login limiter on the same Redis client (ch. 3 §3.2, ch. 5 §5.4) |
| Events                  | Laravel events + auto-discovered listeners                  | `@nestjs/event-emitter`                                                            |
| Queue                   | Laravel queue (queued listeners and jobs)                   | `@nestjs/bullmq` + `bullmq` on Redis                                               |
| Scheduler               | `Schedule::command('model:prune')->hourly()`                | A BullMQ job scheduler (`upsertJobScheduler`), so it runs once however many workers there are |
| Mail                    | Mailables, Postmark in production                           | `nodemailer` (SMTP/log) and the `postmark` client when `MAIL_MAILER=postmark`      |
| Spam classification     | `laravel/ai` → TypeSafe "Jev"                               | Direct `fetch` to the TypeSafe API (ch. 6 §6.4)                                    |
| User-agent parsing      | `donatj/phpuseragentparser`                                 | `ua-parser-js` **v1** (MIT; v2 is AGPL-3.0) with a name-mapping layer (ch. 6 §6.3) |
| File storage            | Laravel filesystem (`FILESYSTEM_DISK`, private)             | Small storage interface with a local-directory implementation (production uses `local`)                 |
| Signed download URLs    | `URL::temporarySignedRoute` + `signed:relative`             | HMAC-SHA256 helper with the same `expires` / `signature` query parameters          |
| API docs                | Scramble at `/docs/api` (spec at `/docs/api.json`)          | `@nestjs/swagger` at the same two paths. **Semi-contractual:** both clients generate their TypeScript types from `/docs/api.json` (ch. 7 §7.2) |
| Tests                   | Pest                                                        | Jest + Supertest (Nest defaults)                                                   |

Why TypeORM: it has built-in soft deletes (`@DeleteDateColumn`), decorator entities and repository scopes. Those map most directly onto Eloquent, which keeps the port mechanical.

Why no `class-validator`: it runs decorators bottom-up, so messages come out in the reverse of Laravel's rule order. It can't tell an absent key from `null`, which `sometimes` and `missing` depend on. It also needs custom code for most Laravel-specific rules anyway. Chapter 4 already needs a Laravel rule interpreter for form schemas, so request bodies use the same engine and produce the same messages.

Nest 11 runs on **Express 5**, whose defaults differ from Express 4 in ways that matter here: the query parser, an empty `req.body`, and wildcard route syntax. Chapter 1 §1.4 lists the settings to change.

## Fix while porting, don't copy these bugs

The port should fix two known issues. Build the corrected behaviour and cover each with a test. Apart from the documented rate-limit header difference (ch. 3 §3.2), these are the **only** places where the new service should differ from the old one.

| #   | Laravel behaviour                                                                                 | Required behaviour                                                         | Where     |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| F7  | Rule names in a form schema aren't checked, so an invalid rule causes a 500 at submission time     | Reject the schema with 422 when the form is saved                          | Ch. 4 §4.5 |
| F9  | The public submission limit (`throttle:300,1`) and the forgot/reset-password limit (`throttle:6,1`) build the same key, `sha1('\|' . ip)`, so they share one counter. Six submissions in a minute lock that IP out of password reset, and password-reset requests count toward the 300 submissions | Separate counters. Forgot and reset still share **their** counter with each other | Ch. 3 §3.6 |

The numbering is kept from earlier revisions of this guide. F1 to F6 and F8 (ownership checks, entry list scoping, referer capture, notification `form_id`, notification `enabled` default, entry `input` validation, `spam_score` precision) have since been fixed in Laravel itself, so they are now plain parity requirements covered by the ported tests.

## Quirks to keep for compatibility

These look odd, but clients may already depend on them. Keep them, and write a test for each so nobody "fixes" them by accident.

- An entry with no validated fields has `input: []`, not `{}`. An export with no filters has `parameters: {}`.
- `spam_score` is a number rounded to 2 decimals everywhere: stored as `numeric(3,2)`, returned as a JSON number (`0.97`, `0.5`, `0`) and written to CSV in the same form. Values with more decimals, whether from a client or from Jev, are rounded when saved.
- Form update requires `name` and `active` (PATCH isn't partial for forms). Notification update requires `type`, `value` and `enabled`. Entry update, by contrast, is fully partial.
- Sending a read-only field (`input`, `ip`, `spam_checked_at`… on entries; `form_id` or `error` on notifications) returns 422, even when its value is `null`. Nothing is silently ignored.
- Lists are oldest first by default, 15 per page. Forms, entries and exports accept `per_page` (1 to 100) and keep every query parameter in their pagination links. Notifications don't: they're fixed at 15 and drop extra query parameters.
- The entry counts (`entries_count`, `unread_entries_count`, `spam_entries_count`) appear only in the form **list**, not in show/create/update.
- Entries and notifications of a soft-deleted form return **403**, not 404, from their shallow routes (show, update, delete, restore). The form's own nested routes return 404.
- Public submissions that trip the honeypot get the normal 201 response.
- `ip` is every client IP from the request, comma-joined, not a single address. The order is Symfony's: the hop **nearest** the server comes first and the original client comes last (ch. 3 §3.5).
- Every string in the input is trimmed, and `""` becomes `null`, before validation and storage, except that `password`, `password_confirmation` and `current_password` aren't trimmed (an empty one still becomes `null`). This comes from Laravel's global `TrimStrings` and `ConvertEmptyStringsToNull` middleware (ch. 3 §3.2).
- Validation sees the query string merged with the body, with body keys winning. A public submission with `?email=x` and no body field `email` validates and stores `email: "x"`.
- A malformed JSON body is treated as an empty body, so it gets 422 rather than 400.
- An authenticated request may carry its JWT in the `Authorization` header, in a `?token=` query parameter, or in a `token` body field (ch. 5 §5.2).
- All timestamps (`created_at`, `read_at`, `spam_checked_at`, `completed_at`, `expires_at`…) are ISO 8601 UTC with six fractional digits: `2026-01-02T03:04:05.000000Z`. The CSV export uses a different format: `2026-01-02T03:04:05Z`.

## Open decisions for the product owner

Settle these before cut-over. The port defaults to the Laravel behaviour.

1. F7: should rule names be checked on save? This guide says yes. It's also open question 2 in the [Forms PRD](product/forms.md).
2. Should the owner-only authenticated entry-create endpoint be kept now that public submissions exist ([Form Entries PRD](product/form-entries.md) open question 4)?
3. ~~Copy the shared submission/password-reset rate-limit counter?~~ Decided 2026-10-03: fix it (F9).

## Definition of done (whole project)

1. Every test in chapter 7's parity matrix passes against the NestJS service.
2. The contract tests (chapter 7 §7.4) pass against **both** the Laravel and the NestJS service. The only allowed differences are F7, F9 and the `X-RateLimit-*` headers (ch. 3 §3.2). JSON responses are compared as parsed values, including object key order, not as bytes: Laravel escapes `/` as `\/` and non-ASCII characters as `\uXXXX`, and `JSON.stringify` does neither. CSV downloads are compared byte for byte.
3. A public submission end to end (browser form → spam check → alert email → Postmark bounce recorded on the recipient) works against staging.
4. `npm run lint`, `npm run typecheck` and `npm test` pass in CI.
5. A fresh deployment works from empty: migrations run, `npm run user:create` creates the operator accounts, and a form can be created and submitted (chapter 2 §2.6: there's no production data to migrate).
