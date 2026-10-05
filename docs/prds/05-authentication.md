# 5. Authentication & Accounts

The Laravel app is headless and authenticates with JSON Web Tokens issued by `tymon/jwt-auth`. There's no web app, session login, self-service registration, two-factor authentication or passkeys. The behaviour to reproduce is in the [Accounts & Authentication PRD](product/accounts-and-authentication.md).

## 5.1 Libraries

- `@nestjs/jwt` to sign and verify tokens (HS256, secret from `JWT_SECRET`).
- A small custom `CanActivate` guard over `JwtService.verifyAsync`. It's simpler than Passport here, because refresh needs a different verification mode.
- `bcrypt` for password checks (§5.8).
- `@nestjs/throttler` with the Redis storage for the forgot/reset-password limit, through the `password` throttler (ch. 3 §3.2, _Rate limiting_). It **can't** do the login limit: login counts only failed attempts and clears the count on success, and the throttler storage can only increment. Implement §5.4 by hand on the shared `ioredis` connection.

## 5.2 Token format

Match tymon's claims so behaviour carries over:

| Claim | Value                                                                                         |
| ----- | --------------------------------------------------------------------------------------------- |
| `iss` | The full request URL that issued it, e.g. `https://host/api/v1/auth/login` (or `/refresh`, `/password`) |
| `sub` | User ID, as a **string**                                                                      |
| `iat` | Issued-at (Unix seconds). **Kept from the original token on refresh**                         |
| `nbf` | The issue time of this token                                                                  |
| `exp` | This token's issue time + `JWT_TTL` minutes (default 60)                                      |
| `jti` | Random 16-character ID, used for the deny list                                                |
| `prv` | `sha1("App\\Models\\User")`, which locks the token to the user model                          |
| `tv`  | The user's `token_version` when the token was issued. Carried through refreshes (§5.6)        |

Verify every token for:

- the signature;
- `exp` and `nbf`, with no leeway;
- `iat` not in the future (tymon rejects that);
- the presence of `iss`, `iat`, `exp`, `nbf`, `sub` and `jti` (tymon's payload factory actually back-fills missing defaults, so only `sub` is enforced there; the port checks all six, which only matters for tokens signed with the secret by someone else);
- the `prv` value;
- a `jti` that isn't on the deny list.

Then run the token-version check. In refresh mode, tymon checks only the structure, `iat + JWT_REFRESH_TTL` and the deny list. `exp` and `nbf` are skipped.

**Where the token comes from.** tymon's parser tries three sources in order and uses the first one it finds:

1. The `Authorization` header (or the `HTTP_AUTHORIZATION` / `REDIRECT_HTTP_AUTHORIZATION` server variables). It finds `bearer` case-insensitively, at its **last** occurrence, takes what follows it, cuts at the first `,`, and trims.
2. The `token` query-string parameter (`?token=…`).
3. A `token` field in the request input (body or query).

Clients may already rely on 2 or 3, for example a download script that can't set headers. Port all three into the guard's token extractor, on authenticated routes and on refresh.

## 5.3 Endpoints

All under `/api/v1/auth`.

| Method | Path               | Guard                                  | Response                                                                          |
| ------ | ------------------ | -------------------------------------- | --------------------------------------------------------------------------------- |
| POST   | `/login`           | none                                   | 200 `{access_token, token_type: "bearer", expires_in}` (`expires_in` = TTL × 60)  |
| POST   | `/refresh`         | token signature only (expiry ignored)  | 200, same shape                                                                   |
| POST   | `/logout`          | valid token                            | 204                                                                               |
| GET    | `/me`              | valid token                            | 200 `{data: {id, name, email, email_verified_at, created_at, updated_at}}`        |
| PATCH  | `/me`              | valid token                            | 200, same shape as `GET /me`                                                      |
| DELETE | `/me`              | valid token                            | 204                                                                               |
| PUT    | `/password`        | valid token                            | 200, login shape                                                                  |
| POST   | `/forgot-password` | none, 6/min per IP                     | 200 `{message}`                                                                   |
| POST   | `/reset-password`  | none, 6/min per IP                     | 200 `{message}`                                                                   |

"Valid token" means signature, claims, deny list and token version (§5.6) all pass. Timestamps use the ISO 8601 format from chapter 3.

**Login**

1. Validate `email` (required, string, email) and `password` (required, string). Use the Laravel error shape (ch. 3 §3.2).
2. Apply the throttle check (§5.4).
3. Look up the user by `lower(email)`. Compare the password with bcrypt.
4. On failure: record the failure, then return 422 `{"message":"These credentials do not match our records.","errors":{"email":["These credentials do not match our records."]}}`.
5. On success: clear the throttle counter and issue a token.

**Refresh**

1. Read the bearer token and verify its signature, `prv` and deny-list status. **Ignore `exp`.** A missing or bad token → 401.
2. Reject the token with 401 if `now > iat + JWT_REFRESH_TTL` minutes (default 10080 = 7 days).
3. Put the old `jti` on the deny list, and issue a new token with the **same `iat`, `sub`, `prv` and `tv`**, and a fresh `iss` (the refresh URL), `jti`, `nbf` and `exp`. (tymon only lists `tv` as persistent, but `prv` survives through its payload factory; the contract suite checks the claim list against Laravel.)
4. Then load the user by `sub`. If the user is gone, or `tv` is behind the user's `token_version`, put the **new** token's `jti` on the deny list too, and return 401.

**Logout:** put the token's `jti` on the deny list, then return 204.

**Any auth failure** (missing, malformed, expired, denied, wrong `prv`, revoked, user deleted) returns `401 {"message":"Unauthenticated."}`.

## 5.4 Login throttling

- Key: `lower(email) + "|" + ip`, transliterated to ASCII (`Str::transliterate`). The port approximates voku's tables (NFKD, a few special letters, `?` for the rest; CJK differs). The key is hashed and never leaves the server, so the only effect is which emails share a counter. `ip` is Laravel's `$request->ip()`: the first entry of the Symfony-ordered list in ch. 3 §3.5, not Express's `req.ip`.
- Every failed login increments a counter with a 60-second decay window.
- When the counter reaches 5, respond 429 **before** checking credentials: `{"message":"Too many login attempts. Please try again in N seconds.","errors":{"email":["Too many login attempts. Please try again in N seconds."]}}`, where N is the seconds left in the window.
- A successful login deletes the counter.

Implementation (`auth/login-limiter.service.ts`), a port of Laravel's `RateLimiter`, which is a fixed window:

- `tooManyAttempts(key, 5)`: the count is ≥ 5 **and** the `:timer` key still exists. If the count is ≥ 5 but the timer has gone, reset the count and return false.
- `hit(key, 60)`: in one Lua script, set `{key}:timer` = (now + 60, in Unix seconds) with `NX` and a 60 s expiry, then `INCR {key}` and give it a 60 s expiry if it has none. The window starts at the first failure, and later failures don't extend it.
- `availableIn(key)`: the timer's value − now, at least 0. This is the `N` in the message.
- `clear(key)`: delete both keys.
- Prefix the Redis keys (`login:`) and hash the transliterated `email|ip`, so user input never forms raw key names.
- Put the store behind an interface, with an in-memory version driven by the `Clock` for unit tests. The ported Pest login tests only count attempts and never move the clock, so they run against either version.

## 5.5 Deny list

Store denied `jti`s in the `denied_tokens` table (ch. 2), the same way `App\Providers\Jwt\DatabaseStorage` does. Don't use a cache: clearing a cache must not revive logged-out tokens.

- **Add:** upsert `{jti, value: {"valid_until": <now unix>}, expires_at}`. Set `expires_at` to the later of the token's `exp` and `iat + JWT_REFRESH_TTL`, plus one minute. Skip the write if the `jti` is already actively denied.
- **Check:** a `jti` is denied if a row exists with `expires_at IS NULL OR expires_at > now`.
- **Prune:** delete rows with `expires_at <= now` hourly (ch. 6 §6.7).

## 5.6 Token revocation (`token_version`)

- Every token carries `tv` = the user's `token_version` at issue time.
- A `TokenVersionGuard` runs after the JWT guard on every authenticated route. If `(payload.tv ?? 0) !== user.token_version`, it returns 401. A token without a `tv` claim counts as version 0.
- Changing or resetting the password increments `token_version`, which revokes every token issued before.

## 5.7 Account management

**Update profile** (`PATCH /auth/me`): lowercase `email` before validating it. Both fields are optional: `name` (if present: required, string, max 255) and `email` (if present: required, string, email, max 255, unique among **other** users → "The email has already been taken."). If the email actually changes, set `email_verified_at = null`. Return the user resource.

**Change password** (`PUT /auth/password`):

1. Validate `current_password` (required, string, must match the user's password → "The password is incorrect.") and `password` (required, string, `confirmed` against `password_confirmation`, `different:current_password`, password policy §5.9).
2. Save the new bcrypt hash and increment `token_version`.
3. Put the presented token's `jti` on the deny list.
4. Issue a fresh token, which carries the new `tv`, and return it in the login shape. Every other token is now revoked.

**Delete account** (`DELETE /auth/me`):

1. Validate `password` (required, string, current password). On failure → 422 on `password` and delete nothing.
2. Put the presented token's `jti` on the deny list.
3. Collect the export file paths of all the user's forms, **including soft-deleted forms**.
4. In one transaction, permanently delete: the user's exports, entries (including deleted ones), notifications (including deleted ones), forms (including deleted ones), the `password_reset_tokens` row for the user's email, and the user.
5. After commit, delete the collected export files from storage.
6. Return 204.

## 5.8 Passwords

- Laravel writes `$2y$` bcrypt hashes. They're identical to `$2b$`, so if your bcrypt library rejects `$2y$`, rewrite the prefix before comparing. Add a test using a real hash copied from the Laravel database.
- Hash new passwords with bcrypt, cost 12 (Laravel's default `BCRYPT_ROUNDS`).

## 5.9 Password policy

New passwords (change, reset and `user:create`) follow `Password::defaults()`:

- **`APP_ENV=production`:** at least 12 characters, at least one uppercase and one lowercase letter, at least one letter, one number and one symbol, and not found in known breaches. The breach check uses the Have I Been Pwned range API (k-anonymity: send the first 5 hex characters of the SHA-1, then match the suffix). If HIBP can't be reached, Laravel treats the password as **not** compromised. Do the same.
- **Elsewhere:** at least 8 characters.

Messages come from `validation.php` (`min.string` and the `password.*` keys, e.g. "The password field must contain at least one symbol." and "The given password has appeared in a data leak. Please choose a different password.").

## 5.10 Password reset

Port Laravel's password broker:

**Forgot** (`POST /auth/forgot-password`):

1. Validate `email` (required, string, email). Lowercase it.
2. If a user has that email, and the user has no reset token created in the last 60 seconds, generate a random 64-character token, store its bcrypt hash in `password_reset_tokens` (replacing any existing row), and email the link `{PASSWORD_RESET_URL}?token={token}&email={email}` (query-encoded).
3. **Always** respond 200 `{"message":"If an account exists for that email, a password reset link has been sent."}`, whether the user exists, the request was throttled or the mail was sent. This stops attackers enumerating emails.

The email mirrors Laravel's `ResetPassword` notification: subject "Reset your password" (the framework's current wording), a "Reset Password" button with the link, and a note that the link expires in 60 minutes. The wording isn't contractual. The link's query string uses PHP's default `http_build_query` encoding (RFC 1738: `+` for spaces, `~` encoded). Like Laravel's broker, forgot and reset take at least 200 ms (`Timebox`), so timing doesn't reveal whether an email exists; a successful reset returns early.

**Reset** (`POST /auth/reset-password`):

1. Validate `token` (required, string), `email` (required, string, email) and `password` (required, string, confirmed, password policy).
2. Look up the user by lowercased email and the reset row. The token must match the stored hash, and the row must be under 60 minutes old. Otherwise → 422 `{"message":"This password reset token is invalid.","errors":{"email":["This password reset token is invalid."]}}`. Use the same response for an unknown email.
3. Save the new password, set a new random 60-character `remember_token`, increment `token_version`, and delete the reset row.
4. Respond 200 `{"message":"Your password has been reset."}`.

Both endpoints share a limit of 6 requests per minute per IP: one `password` throttler counter for both routes (ch. 3 §3.2, _Rate limiting_). Beyond that → 429 `{"message":"Too Many Attempts."}` with `Retry-After`.

In Laravel this counter is also shared with the public submission endpoint's 300/min limit. The port separates them (F9, ch. 3 §3.6).

## 5.11 Operator command

`npm run user:create -- --name=... --email=... --password=...` replaces `php artisan user:create`. Prompt for any missing option, and don't echo the password. Lowercase the email. Validate `name` (required, max 255), `email` (required, email, max 255, unique) and `password` (password policy). Print each error and exit non-zero on failure. On success print `Created user [email] with ID [id].`

## 5.12 Guard and current user

A global or per-module `JwtAuthGuard` verifies the token, loads the user by `sub`, and attaches it to `req.user`. `@CurrentUser()` reads it. Apply it, plus `TokenVersionGuard`, to every `/api/v1` route except: login, refresh, forgot-password, reset-password, public submissions, the export download and the Postmark webhook. Unlike Laravel, there's no redirect-to-login case to handle, because the API only returns JSON.

## 5.13 Cut-over

Rotate `JWT_SECRET` when you switch servers. The Laravel deny list isn't copied (ch. 2 §2.6), so reusing the secret would revive logged-out tokens. Every user logs in again once.

## 5.14 Tests to port

Port these case for case (ch. 7 lists counts):

- `AuthControllerTest`: login (success, case-insensitive email, rejections, throttle, clearing the counter), `me`, token on API requests, logout, deny list surviving a cache clear, deny-list pruning, refresh (rotation, expired token, no token, window from the original login, rejection after 7 days).
- `AccountControllerTest`: profile updates, email lowercasing and verification reset, unique email, password change and revocation, a revoked token can't be refreshed, refreshes keep a token valid, account deletion and its password check, auth required.
- `PasswordResetControllerTest`: link points at `PASSWORD_RESET_URL`, same response for an unknown email, reset revokes tokens, bad token or email gives the same message, confirmation required, throttling.
- `CreateUserCommandTest`.

## Done when

- [ ] All §5.14 tests pass against Nest.
- [ ] A real `$2y$` hash from Laravel verifies.
- [ ] A token is accepted from `Authorization: Bearer`, from `?token=` and from a body `token` field. A token with `iat` in the future is rejected.
- [ ] The contract suite (ch. 7) authenticates by calling `/auth/login` against both servers, rather than using a pre-minted token.
