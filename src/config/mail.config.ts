import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

export const MAILERS = ['postmark', 'smtp', 'log'] as const;

export interface MailConfig {
  mailer: (typeof MAILERS)[number];
  from: { address: string; name: string };
  smtp: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    /** `tls` for implicit TLS (port 465); otherwise STARTTLS when offered. */
    scheme?: string;
  };
  /** Required when `mailer` is `postmark`. */
  postmarkApiKey?: string;
}

export function readMailConfig(r: EnvReader): MailConfig {
  const mailer = r.oneOf('MAIL_MAILER', MAILERS, 'log');
  const postmarkApiKey = r.optional('POSTMARK_API_KEY');
  if (mailer === 'postmark' && postmarkApiKey === undefined) {
    r.fail('POSTMARK_API_KEY is required when MAIL_MAILER=postmark');
  }

  return {
    mailer,
    from: {
      address: r.required('MAIL_FROM_ADDRESS'),
      name: r.optional('MAIL_FROM_NAME', 'Headless Form Handler'),
    },
    smtp: {
      host: r.optional('MAIL_HOST', '127.0.0.1'),
      port: r.int('MAIL_PORT', 2525, 1),
      username: r.optional('MAIL_USERNAME'),
      password: r.optional('MAIL_PASSWORD'),
      scheme: r.optional('MAIL_SCHEME'),
    },
    postmarkApiKey,
  };
}

export const mailConfig = registerAs('mail', () =>
  readOrThrow(process.env, readMailConfig),
);
