# 6. Events, Queues & Background Work

Everything here runs after a request has returned, or on a schedule. Each part is observable through the API (`spam`, `spam_score`, `spam_checked_at`, `user_agent_display`, recipient `error`, export `status`), so it's part of the parity contract even though it isn't a request handler.

## 6.1 Domain events

| Event                      | Emitted                                                     | Payload                              | Listeners                                                       |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| `form.created`             | After a form is created or duplicated                       | `FormCreated { form }`               | none                                                            |
| `form-entry.created`       | After any entry is stored (both submission endpoints)       | `FormEntryCreated { formEntry }`     | none                                                            |
| `form-entry.submitted`     | After a **public** submission is stored, after `created`    | `FormEntrySubmitted { formEntry }`   | `ParseFormEntryUserAgent` (queued), `CheckFormEntryForSpam` (queued) |
| `form-entry.spam-checked`  | When `CheckFormEntryForSpam` finishes, whatever the outcome | `FormEntrySpamChecked { formEntry }` | `SendFormEntryAlerts` (runs in the emitting worker)             |

Use `@nestjs/event-emitter`. Emit **after** the database write commits. Tests assert that the event fired with the right record, the equivalent of `Event::fake()` + `assertDispatched`. Spy on `EventEmitter2.emit` in e2e tests.

Entries created through the authenticated API emit only `form-entry.created`, so they're never spam-checked, alerted or user-agent-parsed.

**Queued listeners.** A Laravel listener that implements `ShouldQueue` runs on a worker, not in the request. In Nest, make the `@OnEvent` handler enqueue a BullMQ job carrying only IDs (`{ entryId }`). The processor reloads the entry, **including soft-deleted rows**, as Laravel's `SerializesModels` does. If the entry was permanently deleted, drop the job silently (`$deleteWhenMissingModels`).

```
public submission ──► form-entry.created
                  └─► form-entry.submitted ──► [queue] parse-user-agent
                                           └─► [queue] check-spam ──► form-entry.spam-checked
                                                                         └─► SendFormEntryAlerts
                                                                               └─► [queue] deliver-alert × N
```

## 6.2 Queues

| Queue job                      | Laravel class                           | Retries                         | On final failure                                     |
| ------------------------------ | --------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `parse-user-agent { entryId }` | `ParseFormEntryUserAgent` listener      | worker default                  | logged                                               |
| `check-spam { entryId }`       | `CheckFormEntryForSpam` listener        | worker default                  | logged (errors from Jev itself are caught, §6.4)     |
| `deliver-alert { recipientId, entryId }` | `DeliverFormEntryAlert` job   | 3 attempts, backoff 60 s then 300 s | write `error` on the recipient, keep the failed job |
| `generate-form-entry-export { exportId }` | `GenerateFormEntryExport` job | worker default                | mark the export `failed`                             |

Configure BullMQ with `attempts: 3` and a custom backoff of `[60_000, 300_000]` for `deliver-alert`. Keep failed alert jobs (`removeOnFail: false`) so an operator can retry them, the equivalent of `php artisan queue:retry`.

## 6.3 User-agent parsing

On `form-entry.submitted`:

1. Load the entry. If `user_agent` is `null` or `""`, do nothing.
2. Otherwise, parse it and store `user_agent_display = { platform, browser, browser_version }`. Use `null` for any part the parser can't identify.

Laravel uses `donatj/phpuseragentparser`. Its names differ from `ua-parser-js`'s, so add a mapping layer and test it with real UA strings from production entries. Known differences to cover:

| donatj value (keep)          | ua-parser-js gives            |
| ---------------------------- | ----------------------------- |
| platform `Macintosh`         | os `macOS` / `Mac OS`         |
| platform `Windows`           | os `Windows`                  |
| platform `iPhone` / `iPad`   | os `iOS` + device model       |
| platform `Android`           | os `Android`                  |
| platform `Linux`             | os `Linux`                    |
| browser `Chrome`, `Firefox`, `Safari`, `Edge` | mostly the same, but `Mobile Safari`, `Chrome Mobile`… need mapping |
| browser_version `129.0.0.0`  | `browser.version` (full string, keep as is) |

Treat exact strings for rare agents as best effort. The PRD example (`Macintosh` / `Chrome` / `129.0.0.0`) and the cases in `FormEntryUserAgentTest` must match exactly.

## 6.4 Spam classification (Jev)

On `form-entry.submitted` (`CheckFormEntryForSpam`):

1. Reload the entry. If `spam === true` (e.g. a honeypot hit), skip classification and go to step 6.
2. If `TYPESAFE_API_KEY` is empty, skip to step 6.
3. Call TypeSafe:

   ```http
   POST https://api.typesafe.ai/v1/systemone
   Authorization: Bearer ${TYPESAFE_API_KEY}
   Content-Type: application/json

   {
     "model": "jev-latest",
     "state": {
       "form_name": "<form name>",
       "referer": "<entry referer>",
       "submission": "<JSON of entry.input, unescaped slashes and unicode, truncated to 10,000 chars + '...'>"
     },
     "questions": {
       "is_spam": {
         "type": "noul",
         "instructions": "This form submission is spam rather than a genuine message from a person using the form.",
         "criteria": {
           "true": "Unsolicited sales or SEO outreach, marketing blasts, scams, phishing, link dropping, gibberish or automated bot filler.",
           "false": "A real person filling in the form for its intended purpose, such as an enquiry, a request, feedback or a sign-up."
         }
       }
     }
   }
   ```

   Leave out `state` keys whose value is `null` or `""` (PHP's `array_filter`). Use a 10-second timeout. `Str::limit` appends `...` when it truncates.

4. On any error (network, timeout, non-2xx), log a warning with `form_entry_id` and the error message, leave the entry as it is, and go to step 6. `spam_checked_at` stays `null`.
5. Read `answers.is_spam`. If it's missing or its `type` isn't `noul`, change nothing. Otherwise, `p = answers.is_spam.noul` is the probability of spam. Update the entry:
   - `spam = p >= 0.9`
   - `spam_score = round(p, 2)`, e.g. `0.97`
   - `spam_reason = "Jev classified this entry as spam."` if spam, otherwise `null`
   - `spam_checked_at = now`
6. Emit `form-entry.spam-checked`, **always**, even when classification was skipped or failed. Alerts depend on it.

Write the TypeSafe client as a small injectable (`JevClient.classify(state): Promise<number | null>`), so tests can fake it the way `Classification::fake()` does.

## 6.5 Alerts

**`SendFormEntryAlerts`** (on `form-entry.spam-checked`):

1. Reload the entry and its form, excluding a soft-deleted form. If `entry.spam === true` or the form is missing/deleted, stop.
2. For each of the form's recipients that isn't deleted, has `enabled = true` and has `type = 'email'`, enqueue `deliver-alert { recipientId, entryId }`. SMS recipients are skipped: SMS delivery is a gap, not part of the port.

**`deliver-alert`** processor (`DeliverFormEntryAlert`):

1. Load the recipient and the entry, **including soft-deleted rows**. If either was permanently deleted, drop the job.
2. Skip silently if the recipient is now disabled or deleted, the entry is deleted, or the entry's form is deleted.
3. Send the `NewFormEntry` email to `recipient.value`.
4. On success, if `recipient.error` isn't `null`, set it to `null`.
5. After the final failed attempt, set `recipient.error` to the exception message truncated to 255 characters, or `"Delivery failed."` if there's no message.

**`NewFormEntry` email:**

- **Subject:** `New entry: {form name}`.
- **Postmark metadata:** `{ "form_notification_id": "<recipient id>" }`. The bounce webhook (ch. 3 §3.9) depends on it. With the `postmark` client, pass `Metadata`. With nodemailer, it's unused.
- **Submission time:** `entry.created_at` in UTC, formatted as PHP `D, M j, Y g:i A` + ` UTC`, e.g. `Sat, Jan 3, 2026 3:04 AM UTC`. If `settings.timezone` is set and isn't `UTC`, show the local time first, in the same format followed by the zone abbreviation (PHP `T`, e.g. `CST`; some zones give an offset such as `+04`), then the UTC time in brackets. Use `Intl.DateTimeFormat(..., { timeZoneName: 'short' })` and check its abbreviations against PHP's for the timezones your users have set.
- **Fields:** `mapFormData` (ch. 4 §4.6) in `order` order, each shown as `label: value`. `value` is `—` for `null` or `""`, `Yes`/`No` for booleans, arrays joined with `, ` (non-scalar items JSON-encoded), otherwise the string. With no fields, show "This form has no fields."
- **HTML part:** an intro line (`A new entry was submitted to <strong>{form}</strong> on {time}.`, with the local time bolded and the UTC time greyed in brackets) and a two-column table of label/value with `white-space: pre-wrap` values. HTML-escape every interpolated value. Never render submitted content as Markdown or links.
- **Text part:** the same intro line without markup, a blank line, then one `label: value` line per field. Laravel's Blade template HTML-escapes the text part too (`&` shows as `&amp;`). Don't copy that: emit plain text.

Mail transport: when `MAIL_MAILER=postmark`, send through the `postmark` client (`sendEmail` with `HtmlBody`, `TextBody`, `Metadata`, `MessageStream: "outbound"`). Otherwise use nodemailer (`smtp`), or a `log` transport that writes the message to the logger.

## 6.6 Export generation

**`generate-form-entry-export`** processor (`GenerateFormEntryExport`):

1. Load the export. If it's gone (pruned), drop the job.
2. Load its form, excluding soft-deleted forms. If it's missing, set `status: "failed"`, `error: "The form was deleted."`, and stop.
3. Set `status: "processing"`.
4. Build the entry query from `export.parameters` with the same `FilterEntries` service the list endpoint uses (ch. 3 §3.5).
5. Write the CSV (below) to a temporary stream, then store it at `entry-exports/{id}.csv` on the export's disk.
6. Set `status: "completed"`, `path`, `row_count` and `completed_at = now`.
7. If anything throws and the job fails for good, set `status: "failed"`, `error: "The export could not be generated."`.

**CSV format** (port of `WriteEntriesCsv`). Byte-compatible output matters, because users open these in spreadsheets and scripts.

- **Columns,** in this order:
  1. `id`, `created_at`.
  2. One column per schema field in `orderedSchema()` order, keyed by input name (`name ?? id`) and headed by `label ?? input name`.
  3. One column per input key found on **any exported entry** that step 2 didn't cover, sorted as strings (byte order), headed by the key.
  4. `read_at`, `starred`, `spam`, `spam_score`, `spam_reason`, `spam_checked_at`, `ip`, `referer`, `user_agent`, `deleted_at`.
- **Values:**
  - Dates are `YYYY-MM-DDTHH:MM:SSZ` (no fractional seconds), or empty.
  - Booleans are `true` / `false`. `null` is empty.
  - `spam_score` is the number's shortest string form, as in the API (`0.97`, `0.5`, `0`). PHP's `(string)` of a float and JavaScript's `String(n)` agree for 2-decimal values.
  - A list of scalars is joined with `, `. Any other array or object is JSON (PHP `json_encode` defaults: `/` escaped as `\/`, non-ASCII as `\uXXXX`).
  - Anything else is the string form.
- **Formula escaping:** if a cell starts with `=`, `+`, `-`, `@`, a tab or a carriage return, prefix it with `'`. This applies to headers too.
- **Quoting** matches PHP's `fputcsv` with an empty escape character. Separator `,`, enclosure `"`, embedded quotes doubled, lines ending in `\n`. A field is enclosed in quotes if it contains `,`, `"`, `\n`, `\r`, `\t` **or a space**. Fields without those characters are left bare. `csv-stringify` doesn't quote on spaces by default, so pass a custom `quoted_match` or write a 10-line formatter.
- Stream entries with a cursor. Don't load them all into memory.

## 6.7 Scheduled pruning

Hourly (`@Cron('0 * * * *')`, matching `Schedule::command('model:prune')->hourly()`):

- Delete `denied_tokens` rows with `expires_at <= now`.
- For each `form_entry_exports` row with `expires_at <= now`: delete its file (if `path` is set), then delete the row.

## Done when

- [ ] All four events are emitted with the right payload, and only on the right endpoints (tested).
- [ ] With Jev faked: a 0.95 probability flags the entry, 0.5 doesn't, a thrown error leaves the entry unchecked, a honeypot hit skips the call, and alerts follow `form-entry.spam-checked` in every case.
- [ ] Alerts go only to enabled, non-deleted email recipients of non-spam public submissions. Retry/backoff and `error` recording work. A successful send clears `error`.
- [ ] The email subject, time formatting (UTC and a non-UTC timezone) and field list match `FormEntryAlertsTest`.
- [ ] The CSV output for the `FormEntryExportControllerTest` fixtures is byte-identical to Laravel's.
- [ ] Pruning removes expired deny-list rows, exports and their files.
