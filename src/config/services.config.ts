import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

/** Optional third-party integrations; each degrades when unset (ch. 6). */
export interface ServicesConfig {
  /** Jev spam classification. Unset means skip classification. */
  typesafeApiKey?: string;
  /** Basic auth for the bounce webhook. Either unset means every call gets 401. */
  postmarkWebhook: { username?: string; password?: string };
}

export function readServicesConfig(r: EnvReader): ServicesConfig {
  return {
    typesafeApiKey: r.optional('TYPESAFE_API_KEY'),
    postmarkWebhook: {
      username: r.optional('POSTMARK_WEBHOOK_USERNAME'),
      password: r.optional('POSTMARK_WEBHOOK_PASSWORD'),
    },
  };
}

export const servicesConfig = registerAs('services', () =>
  readOrThrow(process.env, readServicesConfig),
);
