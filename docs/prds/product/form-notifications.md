# PRD: Form Notifications

**Status:** Configuration and email delivery built; SMS delivery not built · **Owner area:** `FormNotificationController`, `FormNotification` model, `SendFormEntryAlerts` listener, `DeliverFormEntryAlert` job, `App\Mail\NewFormEntry`

## 1. Summary

Form Notifications let an account holder list the recipients who should be alerted when a form receives a new entry. Each recipient is either an email address or an SMS number, and can be enabled or disabled. Email recipients are alerted when an entry is submitted; SMS recipients are stored but not yet alerted.

## 2. Users

- **Account holder** — configures who hears about new submissions to each form.
- **Recipient** — a person (not necessarily a user of the system) who receives the alert.

## 3. Goals

- Configure multiple recipients per form across email and SMS.
- Temporarily turn a recipient off without deleting them.
- Record the last delivery error per recipient so problems are visible.

## 4. Data model

Table `form_notifications`:

| Field                                    | Type                   | Notes                                                             |
| ---------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `id`                                     | ULID (PK)              |                                                                   |
| `form_id`                                | FK (ULID) → `forms.id` |                                                                   |
| `type`                                   | enum `email` \| `sms`  |                                                                   |
| `value`                                  | string                 | Email address or phone number                                     |
| `enabled`                                | boolean                | Default `true`                                                    |
| `error`                                  | string, nullable       | Last delivery failure; cleared by the next successful delivery   |
| `created_at`, `updated_at`, `deleted_at` | timestamps             | Soft-deletable                                                    |

## 5. Functional requirements

Every endpoint below is restricted to the owner of the recipient's form; anyone else receives `403 {"message":"You do not own this form."}`, checked before validation. Recipients of a deleted form are inaccessible (403) until the form is restored.

**FR-1 List recipients.** `GET /api/v1/forms/{form}/notifications` returns the form's recipients, paginated (15 per page), with `links` and `meta`.

**FR-2 Show a recipient.** `GET /api/v1/notifications/{notification}` (shallow route) returns `{ data: { id, form_id, type, value, enabled, error, created_at, updated_at, deleted_at } }`. `created_at`, `updated_at` and `deleted_at` are ISO 8601 UTC strings with microseconds (e.g. `2026-01-02T03:04:05.000000Z`); `deleted_at` is `null` for any record the API can return.

**FR-3 Add a recipient.** `POST /api/v1/forms/{form}/notifications` accepts:

| Field     | Rules                             |
| --------- | --------------------------------- |
| `type`    | required, `email` or `sms`        |
| `value`   | required; see below               |
| `enabled` | optional, boolean, default `true` |

Responds `201` with the recipient resource.

`value` must match `type`: a valid email address (max 255 characters) for `email`, or an E.164 phone number for `sms` (`+`, a country code not starting with 0, at most 15 digits, no spaces or punctuation, e.g. `+14155552671`). Otherwise the request returns 422 on `value`.

`error` is read-only on create and update (it is reserved for the system to report delivery failures): sending it, even as `null`, returns 422 on `error`.

**FR-4 Update a recipient.** `PUT/PATCH /api/v1/notifications/{notification}` accepts `type`, `value` and `enabled` (all required, with `value` validated against `type` as in FR-3 and `enabled` a boolean), and returns the refreshed recipient. A recipient cannot be moved to another form: sending `form_id`, even as `null`, returns 422 on `form_id` and nothing is changed.

**FR-5 Delete and restore a recipient.** `DELETE /api/v1/notifications/{notification}` soft-deletes the recipient and returns `204`; it no longer appears in the list and returns 404 from show and update. `POST /api/v1/notifications/{notification}/restore` clears `deleted_at` and returns `200` with the recipient resource. There is no permanent delete; recipients are removed permanently only when their owner's account is deleted.

## 6. Alert delivery

**FR-6 Alert on new entries.** Once a public submission's spam check is done (`FormEntrySpamChecked`, see Form Entries FR-1a), the `SendFormEntryAlerts` listener queues one `DeliverFormEntryAlert` job per recipient of that form that is enabled, not deleted and of type `email`. Entries flagged as spam, and entries created through the authenticated API, are not alerted. SMS recipients are skipped (see Gaps).

**FR-7 Alert email.** The `NewFormEntry` mailable is sent to the recipient's address with the subject `New entry: {form name}`. It lists the submission time and each schema field's label (sorted by `order`) with the submitted value (`—` when empty; lists joined with `, `), as HTML and plain text. Values are HTML-escaped and never rendered as Markdown, so submitted content cannot inject links or markup.

The submission time is shown in UTC (e.g. `Sat, Jan 3, 2026 3:04 AM UTC`). When the form's `settings.timezone` is set to anything other than `UTC`, the time in that timezone is shown first, bolded in HTML, with the UTC time after it in brackets (e.g. **Fri, Jan 2, 2026 9:04 PM CST** (Sat, Jan 3, 2026 3:04 AM UTC)). The abbreviation comes from the timezone database, so some zones show an offset such as `+04` instead.

**FR-8 Retries and error recording.** A delivery is attempted up to 3 times, waiting 60 seconds and then 300 seconds between attempts. After the final failure, the exception message (truncated to 255 characters) is stored in the recipient's `error`, and the job is kept in `failed_jobs` so an operator can re-run it with `php artisan queue:retry`. A successful delivery clears `error`. A recipient that was disabled or deleted, or an entry that was deleted, after the alert was queued is skipped. Delivery requires a queue worker.

**FR-9 Bounces and spam complaints (Postmark).** Each alert email carries the recipient's ID as Postmark metadata (`form_notification_id`). Postmark's bounce webhook posts to `POST /api/v1/webhooks/postmark/bounces`, authenticated with HTTP basic auth embedded in the webhook URL (`https://USERNAME:PASSWORD@host/api/v1/webhooks/postmark/bounces`, matching `POSTMARK_WEBHOOK_USERNAME` and `POSTMARK_WEBHOOK_PASSWORD`); requests without matching credentials, or when either is unset, return 401.

- A `Bounce` record stores `Bounced ({Type}): {Description}` in the recipient's `error`, and a `SpamComplaint` stores `Marked as spam: {Description}` (both truncated to 255 characters).
- Informational bounce types (`AutoResponder`, `Subscribe`, `Unsubscribe`, `AddressChange`, `ChallengeVerification`, `OpenRelayTest`), other record types, and messages without a known recipient ID are acknowledged with 204 and ignored, so Postmark does not retry them.
- The recipient is not disabled automatically. Because a successful hand-off to the mail server clears `error` (FR-8), a recipient whose address keeps bouncing shows the error again once the next bounce arrives.

`App\Notifications\NewFormEntry` is unused placeholder scaffolding (for alerting the form owner; see Open questions).

## 7. Gaps

- **No SMS delivery.** SMS recipients can be configured but are never alerted; no SMS provider or channel exists.
- **Bounce reporting is Postmark-only.** Bounces and complaints are recorded only when alerts are sent through Postmark (`MAIL_MAILER=postmark`, which needs `symfony/postmark-mailer` and `symfony/http-client`); with any other mailer only send-time failures are recorded.

## 8. Known issues

None currently.

## 9. Open questions

1. Which SMS provider, and how are SMS costs and rate limits handled?
2. Should the form owner be notified by default when no recipients are configured?
3. Should recipients have to verify their address or number before they can be enabled?
