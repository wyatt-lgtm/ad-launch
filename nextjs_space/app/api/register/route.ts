export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isBusinessEmail } from '@/lib/email-validation';
import { createGHLContact } from '@/lib/ghl';
import { sendEmail } from '@/lib/email';
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

    // Link analysis to user and upsert Business record
    if (analysisId) {
      try {
        const analysis = await prisma.analysis.update({
          where: { id: analysisId },
          data: { userId: user.id },
        });

        // Create a Business record from the Analysis data so the dashboard shows it
        if (analysis?.websiteUrl) {
          const biz = await prisma.business.upsert({
            where: { userId_websiteUrl: { userId: user.id, websiteUrl: analysis.websiteUrl } },
            create: {
              userId: user.id,
              websiteUrl: analysis.websiteUrl,
              businessName: analysis.businessName || null,
              businessAddr: analysis.businessAddr || null,
              businessCity: analysis.businessCity || null,
              businessState: analysis.businessState || null,
              businessZip: analysis.businessZip || null,
              businessPhone: analysis.businessPhone || null,
            },
            update: {
              ...(analysis.businessName ? { businessName: analysis.businessName } : {}),
              ...(analysis.businessAddr ? { businessAddr: analysis.businessAddr } : {}),
              ...(analysis.businessCity ? { businessCity: analysis.businessCity } : {}),
              ...(analysis.businessState ? { businessState: analysis.businessState } : {}),
              ...(analysis.businessZip ? { businessZip: analysis.businessZip } : {}),
              ...(analysis.businessPhone ? { businessPhone: analysis.businessPhone } : {}),
            },
          });

          // Link the analysis to the business too
          await prisma.analysis.update({
            where: { id: analysisId },
            data: { businessId: biz.id },
          });

          console.log(`[register] Business upserted: ${biz.id} for user ${user.id} (${analysis.websiteUrl})`);

          // Auto-grant starter credits (idempotent — safe on every upsert)
          try {
            const { grantStarterCredits } = await import('@/lib/credits');
            const starterResult = await grantStarterCredits(biz.id, { userId: user.id });
            if (starterResult.success && !starterResult.alreadyCharged) {
              console.log(`[register] Starter credits granted to business ${biz.id}`);
            }
          } catch (creditErr: any) {
            console.error('[register] Starter credit grant error (non-fatal):', creditErr?.message);
          }
        }
      } catch (linkErr: any) {
        console.error('[register] Analysis/Business link error (non-fatal):', linkErr?.message);
      }
    }

    // Still create GHL contact for CRM tracking (fire and forget)
    createGHLContact(email).catch(() => {});

    // Send confirmation email via Abacus notification system
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    const confirmLink = `${baseUrl}/confirm?token=${confirmationToken}`;

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
      emailSent = await sendEmail({
        to: email,
        subject: 'Confirm your email - Ad Launch',
        html: htmlBody,
        fromName: 'Ad Launch',
      });
      if (emailSent) {
        console.log('[register] Confirmation email sent to', email);
      } else {
        console.error('[register] Email send failed');
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
