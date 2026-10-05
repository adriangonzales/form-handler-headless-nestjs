import { Mailer, type MailMessage } from '../../src/mail/mailer';

/** `Mail::fake()` / `Notification::fake()`: records instead of sending. */
export class FakeMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  sentTo(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}
