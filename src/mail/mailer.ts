import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ServerClient } from 'postmark';
import type { MailConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Postmark `Metadata` (the bounce webhook reads `form_notification_id`). */
  metadata?: Record<string, string>;
}

/** Sends mail through the configured transport (`MAIL_MAILER`, ch. 6 §6.6). */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/** `log`: writes the message to the logger instead of sending it. */
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mail');

  constructor(private readonly from: MailConfig['from']) {
    super();
  }

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      [
        `From: ${this.from.name} <${this.from.address}>`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
      ].join('\n'),
    );
    return Promise.resolve();
  }
}

/** `smtp` through nodemailer. */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(private readonly config: MailConfig) {
    super();
    const { smtp } = config;
    this.transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.scheme === 'tls' || smtp.scheme === 'smtps',
      auth:
        smtp.username === undefined
          ? undefined
          : { user: smtp.username, pass: smtp.password ?? '' },
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: { name: this.config.from.name, address: this.config.from.address },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}

/** `postmark` through Postmark's client, with `Metadata`. */
export class PostmarkMailer extends Mailer {
  private readonly client: ServerClient;

  constructor(private readonly config: MailConfig) {
    super();
    this.client = new ServerClient(config.postmarkApiKey ?? '');
  }

  async send(message: MailMessage): Promise<void> {
    await this.client.sendEmail({
      From: `${this.config.from.name} <${this.config.from.address}>`,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      Metadata: message.metadata,
      MessageStream: 'outbound',
    });
  }
}

export function createMailer(config: MailConfig): Mailer {
  switch (config.mailer) {
    case 'postmark':
      return new PostmarkMailer(config);
    case 'smtp':
      return new SmtpMailer(config);
    case 'log':
      return new LogMailer(config.from);
  }
}
