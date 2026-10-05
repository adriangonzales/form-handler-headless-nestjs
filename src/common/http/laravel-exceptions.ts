import { HttpException } from '@nestjs/common';
import { summarize } from '../validation/messages';

/**
 * Exceptions rendered with Laravel's bodies and headers by
 * `LaravelExceptionFilter` (ch. 3 §3.2, _Errors_).
 */
export class LaravelHttpException extends HttpException {
  constructor(
    status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message, status);
  }
}

/** 401 `{"message":"Unauthenticated."}`. */
export class AuthenticationException extends LaravelHttpException {
  constructor() {
    super(401, 'Unauthenticated.');
  }
}

/** 403 with a policy message, e.g. "You do not own this form.". */
export class AuthorizationException extends LaravelHttpException {
  constructor(message = 'This action is unauthorized.') {
    super(403, message);
  }
}

/** 429 `{"message":"Too Many Attempts."}` plus `Retry-After` (no `X-RateLimit-*`, ch. 3 §3.2). */
export class ThrottleRequestsException extends LaravelHttpException {
  constructor(retryAfterSeconds: number) {
    super(429, 'Too Many Attempts.', {
      'Retry-After': String(Math.max(0, retryAfterSeconds)),
    });
  }
}

/** 422 (or `->status()`, e.g. 429 on login) with Laravel's validation body. */
export class ValidationException extends LaravelHttpException {
  constructor(
    message: string,
    readonly errors: Map<string, string[]>,
    status = 422,
  ) {
    super(status, message);
  }

  /** `ValidationException::withMessages()`: one message per attribute. */
  static withMessages(
    messages: Record<string, string>,
    status = 422,
  ): ValidationException {
    const errors = new Map(
      Object.entries(messages).map(([key, message]) => [key, [message]]),
    );
    return new ValidationException(
      summarize([...errors.values()].flat()),
      errors,
      status,
    );
  }

  /** `{"message": …, "errors": {"field": ["…"]}}` with keys in Laravel's order. */
  body(): { message: string; errors: Record<string, string[]> } {
    return { message: this.message, errors: Object.fromEntries(this.errors) };
  }
}
