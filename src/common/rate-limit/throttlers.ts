import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { clientIp } from '../http/trust-proxy';

/** The three HTTP rate limits (ch. 3 §3.2). The login limiter is separate (ch. 5 §5.4). */
export const Throttler = {
  /** `throttle:300,1` on public submissions, per client IP. */
  SubmissionsIp: 'submissions-ip',
  /** `form-submissions` (60/min) per raw `:form` segment + `|` + IP. */
  SubmissionsForm: 'submissions-form',
  /** `throttle:6,1` on forgot/reset password: one counter for both routes. */
  Password: 'password',
} as const;

export type ThrottlerName = (typeof Throttler)[keyof typeof Throttler];

const MINUTE = 60_000;

/**
 * Registration order matters: the guard checks (and counts) in this order, so
 * a request `submissions-form` rejects still counts toward `submissions-ip`,
 * as Laravel's two middleware do.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  { name: Throttler.SubmissionsIp, limit: 300, ttl: MINUTE },
  {
    name: Throttler.SubmissionsForm,
    limit: 60,
    ttl: MINUTE,
    // Laravel: $request->route()->originalParameter('form').'|'.$request->ip()
    getTracker: (req) => {
      const request = req as Request;
      return `${String(request.params.form ?? '')}|${clientIp(request)}`;
    },
  },
  { name: Throttler.Password, limit: 6, ttl: MINUTE },
];
