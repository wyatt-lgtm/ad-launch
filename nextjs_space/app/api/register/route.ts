export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isBusinessEmail } from '@/lib/email-validation';
import { createGHLContact } from '@/lib/ghl';
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

    // Still create GHL contact for CRM tracking (fire and forget)
    createGHLContact(email).catch(() => {});

    // Send confirmation email via Abacus notification system
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    const confirmLink = `${baseUrl}/confirm?token=${confirmationToken}`;

    const appUrl = process.env.NEXTAUTH_URL || baseUrl;
    let appHostname = 'ad-launch';
    try { appHostname = new URL(appUrl).hostname.split('.')[0]; } catch {}

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563EB; margin: 0;">Ad Launch</h1>
        </div>
        <h2 style="color: #1E293B;">Confirm Your Email</h2>
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hi there!</p>
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">Click the button below to confirm your email and download your <strong>3 free ads</strong>:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${confirmLink}" style="background-color: #2563EB; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">Confirm My Email</a>
        </div>
        <p style="color: #94A3B8; font-size: 14px;">If the button doesn't work, copy and paste this link:<br/>${confirmLink}</p>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;"/>
        <p style="color: #94A3B8; font-size: 12px; text-align: center;">Thanks,<br/>The Ad Launch Team</p>
      </div>
    `;

    let emailSent = false;
    try {
      const emailRes = await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_token: process.env.ABACUSAI_API_KEY,
          app_id: process.env.WEB_APP_ID,
          notification_id: process.env.NOTIF_ID_EMAIL_CONFIRMATION,
          subject: 'Confirm your email - Ad Launch',
          body: htmlBody,
          is_html: true,
          recipient_email: email,
          sender_email: `noreply@${appHostname}.abacusai.app`,
          sender_alias: 'Ad Launch',
        }),
      });
      const emailData = await emailRes.json().catch(() => ({}));
      emailSent = !!emailData?.success;
      if (!emailSent) {
        console.error('[register] Email send failed:', JSON.stringify(emailData));
      } else {
        console.log('[register] Confirmation email sent to', email);
      }
    } catch (emailErr: any) {
      console.error('[register] Email send error:', emailErr?.message);
    }

    return NextResponse.json({
      success: true,
      message: 'Check your email for confirmation link',
      emailSent,
      userId: user.id,
    });
  } catch (err: any) {
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
