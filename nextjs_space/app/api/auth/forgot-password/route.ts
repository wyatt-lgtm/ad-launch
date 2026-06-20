export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';

/**
 * POST /api/auth/forgot-password
 * Generates a password reset token, stores it, and emails a reset link.
 * Always returns success to avoid leaking whether an email exists.
 */
export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Look up user — but always return same response regardless
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

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
        data: {
          userId: user.id,
          token,
          expiresAt,
        },
      });

      // Build reset link using the runtime host
      const appHost = process.env.NEXTAUTH_URL || 'https://connect.launchmarketing.com';
      const resetLink = `${appHost}/reset-password?token=${token}`;

      const htmlBody = `
        <div style="font-family: 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1E293B; font-size: 24px; margin: 0;">Reset Your Password</h1>
          </div>
          <p style="color: #475569; font-size: 15px; line-height: 1.6;">We received a request to reset your password. Click the button below to choose a new one:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="display: inline-block; padding: 14px 32px; background-color: #2563EB; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px;">Reset Password</a>
          </div>
          <p style="color: #94A3B8; font-size: 13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          <p style="color: #94A3B8; font-size: 13px; margin-top: 8px;">If the button doesn't work, copy and paste this link:<br/>${resetLink}</p>
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;"/>
          <p style="color: #94A3B8; font-size: 12px; text-align: center;">— The Launch OS Team</p>
        </div>
      `;

      try {
        const emailSent = await sendEmail({
          to: normalizedEmail,
          subject: 'Reset your password - Launch OS',
          html: htmlBody,
          fromName: 'Launch OS',
        });
        if (!emailSent) {
          console.error('[forgot-password] Email send failed');
        } else {
          console.log('[forgot-password] Reset email sent to', normalizedEmail);
        }
      } catch (emailErr: any) {
        console.error('[forgot-password] Email send error:', emailErr?.message);
      }
    }

    // Always return success — no information leakage
    return NextResponse.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err: any) {
    console.error('[forgot-password] Error:', err?.message);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
  }
}
