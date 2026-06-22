export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { createGHLContact, sendGHLEmail } from '@/lib/ghl';
import crypto from 'crypto';

/**
 * Resolve the public application URL for reset links.
 * Priority: NEXT_PUBLIC_APP_URL > NEXTAUTH_URL > hardcoded fallback.
 */
function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://connect.launchmarketing.com'
  );
}

function buildResetHtml(resetLink: string): string {
  return `
    <div style="font-family: 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #2563EB; margin: 0;">Launch OS</h1>
      </div>
      <h2 style="color: #1E293B; font-size: 20px;">Reset Your Password</h2>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">We received a request to reset your password. Click the button below to choose a new one:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="display: inline-block; padding: 14px 32px; background-color: #2563EB; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px;">Reset Password</a>
      </div>
      <p style="color: #94A3B8; font-size: 13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      <p style="color: #94A3B8; font-size: 13px; margin-top: 8px;">If the button doesn't work, copy and paste this link:<br/>${resetLink}</p>
      <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;"/>
      <p style="color: #94A3B8; font-size: 12px; text-align: center;">Thanks,<br/>The Launch OS Team</p>
    </div>
  `;
}

/**
 * POST /api/auth/forgot-password
 * Generates a password reset token, stores it, and emails a reset link.
 *
 * Email delivery strategy (try in order, first success wins):
 *   1. GHL via createGHLContact + sendGHLEmail — primary, works when GHL_API_TOKEN is set
 *   2. SMTP via sendEmail() — fallback, works when EMAIL_PROVIDER=smtp and SMTP_* vars are set
 *
 * Always returns success to avoid leaking whether an email exists.
 */
export async function POST(request: Request) {
  const diagnostics: string[] = [];
  const diag = (msg: string) => { diagnostics.push(msg); console.log('[forgot-password]', msg); };

  try {
    const body = await request.json();
    const { email } = body;
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    diag(`User lookup: ${user ? 'found' : 'not found'}`);

    if (user) {
      // Invalidate any existing unused tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, used: false },
        data: { used: true },
      });

      // Generate a secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });

      const appUrl = getAppUrl();
      const resetLink = `${appUrl}/reset-password?token=${token}`;
      const htmlBody = buildResetHtml(resetLink);
      diag(`Token created | link host: ${appUrl}`);

      let emailSent = false;

      // Strategy 1: GHL (primary) — subtenant credentials for transactional email
      const ghlToken = process.env.GHL_API_TOKEN || process.env.GHL_MASTER_API_TOKEN;
      diag(`GHL token: ${!!ghlToken} | prefix: ${ghlToken?.substring(0, 15) || 'none'}`);

      if (ghlToken) {
        try {
          diag(`Creating GHL contact for ${normalizedEmail}`);
          const contactResult = await createGHLContact(normalizedEmail);
          diag(`Contact result — success: ${contactResult.success} | contactId: ${contactResult.contactId} | data: ${JSON.stringify(contactResult.data)?.substring(0, 300)}`);

          if (contactResult.contactId) {
            diag(`Sending GHL email to contactId: ${contactResult.contactId}`);
            const emailResult = await sendGHLEmail(
              contactResult.contactId,
              'Reset your password - Launch OS',
              htmlBody,
            );
            diag(`Email result — success: ${emailResult.success} | data: ${JSON.stringify(emailResult.data)?.substring(0, 300)}`);

            if (emailResult.success) {
              emailSent = true;
              diag('✅ Reset email sent via GHL');
            } else {
              diag('❌ GHL email send returned unsuccessful');
            }
          } else {
            diag('❌ No contactId returned from GHL');
          }
        } catch (ghlErr: any) {
          diag(`❌ GHL exception: ${ghlErr?.message}`);
        }
      } else {
        diag('⚠️ No GHL token configured — skipping GHL');
      }

      // Strategy 2: SMTP fallback
      if (!emailSent) {
        diag('Trying SMTP fallback...');
        try {
          emailSent = await sendEmail({
            to: normalizedEmail,
            subject: 'Reset your password - Launch OS',
            html: htmlBody,
            fromName: 'Launch OS',
          });
          diag(`SMTP result: ${emailSent}`);
        } catch (smtpErr: any) {
          diag(`SMTP error: ${smtpErr?.message}`);
        }
      }

      if (!emailSent) {
        diag(`ALL providers failed | GHL: ${!!ghlToken} | SMTP: ${!!process.env.SMTP_HOST}`);
      }
    }

    return NextResponse.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err: any) {
    diag(`Fatal error: ${err?.message}`);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
  }
}