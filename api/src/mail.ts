import nodemailer from 'nodemailer';
import { config } from './config.js';
import { log } from './log.js';

const smtpConfigured = Boolean(config.smtp.host);

const transport = smtpConfigured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export const mailConfigured = smtpConfigured;

export async function sendPasswordReset(to: string, resetUrl: string): Promise<void> {
  const subject = 'Επαναφορά κωδικού - Diet Mentor';
  const text =
    'Λάβαμε αίτημα επαναφοράς κωδικού για τον λογαριασμό σας.\n\n' +
    `Πατήστε τον παρακάτω σύνδεσμο (ισχύει για 1 ώρα):\n${resetUrl}\n\n` +
    'Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.';

  if (!transport) {
    log.warn({ email: to, resetUrl }, 'SMTP not configured - the password reset link is only in this log line');
    return;
  }
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
  log.info({ email: to }, 'password reset e-mail sent');
}
