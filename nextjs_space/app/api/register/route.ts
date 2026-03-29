export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isBusinessEmail } from '@/lib/email-validation';
import { sendConfirmationEmail } from '@/lib/ghl';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, analysisId } = body ?? {};
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    const validation = isBusinessEmail(email);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    let user = await prisma.user.findUnique({ where: { email } });
    const confirmationToken = crypto.randomBytes(32).toString('hex');

    if (user) {
      if (user.confirmed) {
        return NextResponse.json({ error: 'Account already confirmed. Please log in.' }, { status: 400 });
      }
      user = await prisma.user.update({
        where: { email },
        data: { confirmationToken },
      });
    } else {
      const hashed = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: { email, password: hashed, confirmationToken },
      });
    }

    // Link analysis to user
    if (analysisId) {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { userId: user.id },
      }).catch(() => {});
    }

    // Send confirmation email via GHL
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    const emailResult = await sendConfirmationEmail(email, confirmationToken, baseUrl);

    return NextResponse.json({
      success: true,
      message: 'Check your email for confirmation link',
      emailSent: emailResult.success,
      userId: user.id,
    });
  } catch (err: any) {
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
