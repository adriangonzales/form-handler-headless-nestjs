# Product Requirements — Headless Form Handler

These documents describe the system **as it is currently built** (as of 2026-10-01). They are descriptive, not aspirational: each PRD records what the product does today, and calls out known gaps, bugs, and open questions separately so they can be turned into future work.

## Product summary

The Headless Form Handler is a backend service that lets an account holder define forms, receive submissions ("entries") for those forms over a JSON API, and configure who should be notified when a submission arrives. The forms themselves are rendered elsewhere (a website, a static site, a mobile app); this service only stores form definitions, validates and stores submitted data, and exposes it back through the API.

The service is headless: there is no web interface. Account holders authenticate against the API with JSON Web Tokens.

## Documents

| PRD                                                         | Scope                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Forms](forms.md)                                           | Creating and managing form definitions, the field schema, and settings                    |
| [Form Entries](form-entries.md)                             | Accepting submissions, validation against the schema, captured metadata, triaging entries |
| [Form Notifications](form-notifications.md)                 | Per-form email/SMS notification recipients and new-entry alerts                           |
| [Accounts & Authentication](accounts-and-authentication.md) | JWT login, refresh, logout and current-user endpoints                                     |

## System at a glance

```
User (account holder)
 └── Form               name, active, schema (fields + rules), settings
      ├── FormEntry      submitted data + request metadata + triage state
      └── FormNotification  email/sms recipient, enabled flag
```

- **Stack:** Laravel 13, PHP 8.4, `tymon/jwt-auth` (API auth), `spatie/laravel-data` (settings), Pest (tests).
- **Identifiers:** Forms, entries and notifications use ULIDs. Users use auto-increment integers.
- **Deletion:** All three form-domain tables support soft deletes. Forms, entries and notifications can be deleted and restored through the API; only entries can be permanently deleted.
- **API base path:** `/api/v1`. Everything except `auth/login`, `auth/refresh`, the password reset and webhook endpoints, and public submissions (`POST forms/{form}/submissions`) requires a JWT bearer token (`auth:api`).
- **Scaffolding source:** The domain was generated from `draft.yaml` (Laravel Blueprint) and then hand-edited; the YAML is no longer an exact match for the code.

## Cross-cutting status

| Capability                                                         | Status                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Form CRUD (list, show, create, update, delete, restore, duplicate) | Built                                                                                                                          |
| Schema-driven submission validation                                | Built                                                                                                                          |
| Entry list / show / update / delete / bulk actions / CSV export    | Built                                                                                                                          |
| Public (unauthenticated) submissions                               | Built. Restricted by `settings.domains` via `Referer`, rate limited, optional honeypot; no CAPTCHA                             |
| Ownership authorization                                            | Enforced on every authenticated form, entry, notification and export endpoint                                                  |
| Notifications on new entry                                         | Email alerts built, with Postmark bounce recording. SMS **not built**                                                          |
| Spam detection, IP geolocation, UA parsing                         | UA parsing built. Honeypot and Jev classification for spam; no CAPTCHA, no IP geolocation                                      |
| Delete / restore via API                                           | Built for forms, entries (plus permanent delete) and notifications. Duplicate built for forms                                  |
| Authentication                                                     | Built: JWT login, refresh, logout, current user                                                                                |
| Account management (password reset, profile, account deletion)    | Built. No self-service registration: accounts are created by an operator                                                       |
| Web interface                                                      | None. Headless by design                                                                                                       |

## Conventions used in these PRDs

- **FR-x** — a functional requirement the current system satisfies.
- **Gap** — something a reasonable user would expect that is not implemented.
- **Known issue** — implemented behaviour that appears incorrect or inconsistent.
- **Open question** — a product decision that the code does not settle.
