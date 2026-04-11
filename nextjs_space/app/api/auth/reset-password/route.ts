export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

/**
 * POST /api/auth/reset-password
 * Validates the reset token and updates the user's password.
 */
export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ success: false, error: 'Reset token is required' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ success: false, error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Find valid, unused, non-expired token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      return NextResponse.json({ success: false, error: 'Invalid or expired reset link' }, { status: 400 });
    }
    if (resetToken.used) {
      return NextResponse.json({ success: false, error: 'This reset link has already been used' }, { status: 400 });
    }
    if (resetToken.expiresAt < new Date()) {
      return NextResponse.json({ success: false, error: 'This reset link has expired. Please request a new one.' }, { status: 400 });
    }

    // Hash and update password
    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: hashed },
    });

    // Mark token as used
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    });

    console.log('[reset-password] Password updated for user', resetToken.userId);

    return NextResponse.json({ success: true, message: 'Password has been reset. You can now sign in.' });
  } catch (err: any) {
    console.error('[reset-password] Error:', err?.message);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
  }
}
