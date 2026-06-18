/**
 * Email abstraction layer — provider-agnostic email sending.
 *
 * Provider selection via EMAIL_PROVIDER env var:
 *   - "smtp"  → SMTP via nodemailer (works with Resend, SES, SendGrid, any SMTP relay)
 *   - "log"   → Console-only (development / fallback when no provider configured)
 *
 * Required env vars per provider:
 *   smtp: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   log:  (none)
 *
 * Optional: EMAIL_FROM (default: noreply@<NEXTAUTH_URL hostname>)
 */

import nodemailer from 'nodemailer';

export interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
  /** Override the From address for this email */
  from?: string;
  /** Override the From display name */
  fromName?: string;
}

function getDefaultFrom(): string {
  const url = process.env.NEXTAUTH_URL || '';
  try {
    const hostname = new URL(url).hostname;
    return `noreply@${hostname}`;
  } catch {
    return 'noreply@launchmarketing.com';
  }
}

// ── SMTP Provider ─────────────────────────────────────────────────────────────

let _smtpTransport: nodemailer.Transporter | null = null;

function getSmtpTransport(): nodemailer.Transporter {
  if (!_smtpTransport) {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      throw new Error(
        '[email] SMTP provider selected but missing env vars. Required: SMTP_HOST, SMTP_USER, SMTP_PASS'
      );
    }

    _smtpTransport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return _smtpTransport;
}

async function sendViaSmtp(opts: SendEmailOpts): Promise<boolean> {
  const transport = getSmtpTransport();
  const from = opts.from || process.env.EMAIL_FROM || getDefaultFrom();
  const fromField = opts.fromName ? `"${opts.fromName}" <${from}>` : from;

  const info = await transport.sendMail({
    from: fromField,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  console.log(`[email/smtp] Sent to ${opts.to}, messageId=${info.messageId}`);
  return true;
}

// ── Log Provider (development) ────────────────────────────────────────────────

async function sendViaLog(opts: SendEmailOpts): Promise<boolean> {
  console.log(`[email/log] TO: ${opts.to} | SUBJECT: ${opts.subject}`);
  console.log(`[email/log] HTML length: ${opts.html.length} chars`);
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send an email using the configured provider.
 * Returns true on success, false on failure (never throws).
 */
export async function sendEmail(opts: SendEmailOpts): Promise<boolean> {
  const provider = (process.env.EMAIL_PROVIDER || 'log').toLowerCase();

  try {
    switch (provider) {
      case 'smtp':
        return await sendViaSmtp(opts);
      case 'log':
        return await sendViaLog(opts);
      default:
        console.warn(`[email] Unknown EMAIL_PROVIDER "${provider}", falling back to log`);
        return await sendViaLog(opts);
    }
  } catch (err: any) {
    console.error(`[email] Send failed (provider=${provider}):`, err?.message);
    return false;
  }
}
