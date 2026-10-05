import type { MailMessage } from '../mail/mailer';

/** Minutes a reset link stays valid (`auth.passwords.users.expire`). */
const EXPIRE_MINUTES = 60;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[c] ?? c,
  );
}

/**
 * Laravel's `ResetPassword` notification (ch. 5 §5.10). The wording follows
 * the framework's; it isn't contractual.
 */
export function resetPasswordMail(to: string, url: string): MailMessage {
  const lines = [
    'You are receiving this email because we received a password reset request for your account.',
    `This password reset link will expire in ${EXPIRE_MINUTES} minutes.`,
    'If you did not request a password reset, no further action is required.',
  ];
  const link = escapeHtml(url);
  return {
    to,
    subject: 'Reset your password',
    text: [
      'Hello!',
      '',
      lines[0],
      '',
      `Reset Password: ${url}`,
      '',
      lines[1],
      '',
      lines[2],
    ].join('\n'),
    html: [
      '<p>Hello!</p>',
      `<p>${lines[0]}</p>`,
      `<p><a href="${link}">Reset Password</a></p>`,
      `<p>${lines[1]}</p>`,
      `<p>${lines[2]}</p>`,
      `<p>If you're having trouble clicking the "Reset Password" button, copy and paste the URL below into your web browser: <a href="${link}">${link}</a></p>`,
    ].join('\n'),
  };
}
