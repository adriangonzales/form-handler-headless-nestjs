# PRD: Accounts & Authentication

**Status:** Built (JWT API only) · **Owner area:** `AuthController`, `AccountController`, `PasswordResetController`, `user:create` command, `LoginRequest`, `UserResource`, `tymon/jwt-auth`, `DatabaseStorage`, `DeniedToken`, `config/auth.php`, `config/jwt.php`

## 1. Summary

The system is a headless JSON API; there is no web interface. Account holders authenticate by exchanging their email and password for a JSON Web Token (JWT) and send it as a bearer token on every API request. Tokens are short-lived and can be refreshed for a longer window. Authentication uses [`tymon/jwt-auth`](https://github.com/tymondesigns/jwt-auth) through an `api` guard with the `jwt` driver, which is the application's default guard.

## 2. Users

- **Account holder**: owns forms and calls the API with a JWT.
- **Operator / admin**: creates accounts with `php artisan user:create`. There is no self-service sign-up.

## 3. Endpoints

All under `/api/v1/auth`.

| Method | Path               | Auth required          | Purpose                                      |
| ------ | ------------------ | ---------------------- | -------------------------------------------- |
| POST   | `/login`           | No                     | Exchange email and password for a token      |
| POST   | `/refresh`         | Token (may be expired) | Exchange a token for a new one               |
| POST   | `/logout`          | Yes                    | Invalidate the current token                 |
| GET    | `/me`              | Yes                    | The authenticated user                       |
| PATCH  | `/me`              | Yes                    | Update name or email                         |
| DELETE | `/me`              | Yes                    | Permanently delete the account and its data  |
| PUT    | `/password`        | Yes                    | Change password; revokes all other tokens    |
| POST   | `/forgot-password` | No                     | Email a password reset link                  |
| POST   | `/reset-password`  | No                     | Set a new password with an emailed token     |

## 4. Functional requirements

**FR-1 Log in.** `POST /api/v1/auth/login` with `email` (required, email) and `password` (required, string). The email is matched case-insensitively. On success it returns:

```json
{ "access_token": "<jwt>", "token_type": "bearer", "expires_in": 3600 }
```

`expires_in` is in seconds and follows `JWT_TTL` (minutes, default 60). Wrong credentials return 422 with `errors.email = ["These credentials do not match our records."]`.

**FR-2 Login throttling.** After 5 failed attempts for the same email and IP address, further attempts return 429 with an `errors.email` message saying how many seconds remain, until the minute window passes. A successful login clears the counter.

**FR-3 Authenticated requests.** Every `/api/v1` route other than login and refresh requires `Authorization: Bearer <token>`. A missing, malformed, expired, invalidated or revoked (see FR-8) token returns `401 {"message":"Unauthenticated."}`. All responses, including errors, are JSON. Guests are never redirected.

**FR-4 Refresh.** `POST /api/v1/auth/refresh` with the current token, which may already be expired, returns a new token in the FR-1 shape. The old token is blacklisted. The refresh window is measured from the **original login**: a refreshed token keeps the first token's issued-at (`iat`) claim, so a chain of refreshes ends `JWT_REFRESH_TTL` minutes (default 10080 = 7 days) after login and the user must log in again. After that, without a valid token, or for a revoked token (FR-8), refresh returns 401.

**FR-5 Log out.** `POST /api/v1/auth/logout` blacklists the current token and returns 204.

**FR-6 Current user.** `GET /api/v1/auth/me` returns `{ "data": { id, name, email, email_verified_at, created_at, updated_at } }`. The password and remember token are never exposed.

**FR-7 Configuration.** `JWT_SECRET` signs tokens (HS256). `composer setup` generates one with `php artisan jwt:secret`. Tests use a fixed secret from `phpunit.xml`. `PASSWORD_RESET_URL` is the client page reset emails link to (default `{APP_URL}/reset-password`).

**FR-7a Deny list.** Logged-out (FR-5), refreshed (FR-4) and otherwise invalidated tokens (FR-13) are stored by their `jti` claim in the `denied_tokens` table (`DeniedToken` model), through the `App\Providers\Jwt\DatabaseStorage` storage provider set in `config/jwt.php`. Clearing the cache does not affect it. A row is kept until the token could no longer be used or refreshed (the later of its expiry and the end of its refresh window, plus a minute), and the hourly `model:prune` then deletes it.

**FR-8 Token revocation.** Each user has a `token_version`, embedded in every token as the `tv` claim and carried through refreshes. Changing or resetting the password increments it, which revokes every token issued before; tokens issued afterwards carry the new version. The `token.current` middleware (on every authenticated route) and the refresh endpoint reject tokens whose version is behind with 401.

**FR-9 Create an account (operator).** `php artisan user:create --name= --email= --password=` creates an account holder; any option left out is prompted for, so the password can be kept out of shell history. The email is lowercased and must be unused, and the password must satisfy the password policy (FR-12). There is no API endpoint for registration.

**FR-10 Update profile.** `PATCH /api/v1/auth/me` accepts `name` (string, max 255) and `email` (email, max 255, unique, lowercased); both are optional. Changing the email clears `email_verified_at`. Returns the FR-6 user resource.

**FR-11 Change password.** `PUT /api/v1/auth/password` with `current_password`, `password` and `password_confirmation`. The new password must differ from the current one and satisfy the password policy. On success every existing token is revoked (FR-8), including the one used for the request, and a new token is returned in the FR-1 shape so the client stays signed in. A wrong current password returns 422 on `current_password`.

**FR-12 Password reset.**

- `POST /api/v1/auth/forgot-password` with `email` always returns `200 {"message":"If an account exists for that email, a password reset link has been sent."}`, whether or not the account exists or the broker throttled the request (one email per 60 seconds per account), so emails cannot be enumerated. For an existing account it emails a link to `PASSWORD_RESET_URL?token=...&email=...`. Tokens expire after 60 minutes.
- `POST /api/v1/auth/reset-password` with `token`, `email`, `password` and `password_confirmation` sets the new password, revokes every existing token (FR-8) and returns `200 {"message":"Your password has been reset."}`. An invalid or expired token, or an unknown email, returns 422 with `errors.email = ["This password reset token is invalid."]`.
- Both endpoints are limited to 6 requests per minute per IP address (429 beyond that).
- New passwords (reset, change, `user:create`) follow `Password::defaults()`: at least 12 characters with mixed case, letters, numbers and symbols, and not found in known breaches, in production; at least 8 characters elsewhere.

**FR-13 Delete account.** `DELETE /api/v1/auth/me` with `password` (the current password) permanently deletes the user, all their forms (including deleted ones), those forms' entries (including deleted ones), notifications and exports, export files, and any pending reset token, then returns 204. The current token is invalidated. A wrong password returns 422 on `password` and nothing is deleted. This cannot be undone.

## 5. Gaps

- **No email verification.** `email_verified_at` is stored and returned but never checked.
- **No multi-factor authentication.** Two-factor authentication and passkeys were removed with the web app.
- **No "log out everywhere".** Logout invalidates only the presented token. Changing or resetting the password revokes every token (FR-8), but there is no endpoint to do that without changing the password.
- **No token scopes.** Every token has full access to the owner's data.

## 6. Known issues

None currently.

## 7. Open questions

1. Is a 60-minute access token with a 7-day refresh window right, or should refresh tokens be separate and revocable?
2. Should per-form public keys be introduced for form submissions, separate from account JWTs?
