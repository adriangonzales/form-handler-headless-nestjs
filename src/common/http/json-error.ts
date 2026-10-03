/**
 * Laravel's request-preparation and routing errors that occur before a Nest
 * handler runs. Thrown from Express middleware or the not-found handler and
 * rendered by `LaravelExceptionFilter`.
 */
import { HttpException } from '@nestjs/common';

/** PHP `post_max_size` exceeded (Laravel `ValidatePostSize`). */
export class PostTooLargeException extends HttpException {
  constructor() {
    super('The POST data is too large.', 413);
  }
}

/** Laravel answers non-reading requests to `web` routes without a token with 419. */
export class CsrfTokenMismatchException extends HttpException {
  constructor() {
    super('CSRF token mismatch.', 419);
  }
}
