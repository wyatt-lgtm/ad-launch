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
    const { email, password, analysisId, anonymousToken } = body ?? {};
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

    // ── Claim anonymous Business + Analysis records ──────────────────────
    // When an anonymous user registers, we find the Business (and its linked
    // Analysis) created during the anonymous session via the anonymousToken.
    // We assign userId, carry over tombstone IDs, and clear the token.
    // This avoids creating duplicate Business records and preserves the
    // Tombstone business_id that was already used for content generation.
    if (analysisId || anonymousToken) {
      try {
        // 1. Try to find the anonymous Business by token
        let existingBiz = anonymousToken
          ? await prisma.business.findUnique({ where: { anonymousToken } })
          : null;

        if (existingBiz) {
          // Claim the anonymous Business: assign userId, clear token
          console.log(`[register] Claiming anonymous Business ${existingBiz.id} (token=${anonymousToken?.slice(0, 8)}…) for user ${user.id}`);

          // Check if user already has a Business for this URL (edge case: user had an account,
          // used anonymous flow, then registered with same email + same URL)
          const duplicateBiz = await prisma.business.findUnique({
            where: { userId_websiteUrl: { userId: user.id, websiteUrl: existingBiz.websiteUrl } },
          });

          if (duplicateBiz) {
            // Merge: keep the existing user's Business, copy over tombstone IDs if missing
            console.log(`[register] User already has Business ${duplicateBiz.id} for ${existingBiz.websiteUrl}, merging tombstone IDs`);
            await prisma.business.update({
              where: { id: duplicateBiz.id },
              data: {
                ...(existingBiz.tombstoneBusinessId && !duplicateBiz.tombstoneBusinessId
                  ? { tombstoneBusinessId: existingBiz.tombstoneBusinessId, tombstoneBusinessUuid: existingBiz.tombstoneBusinessUuid }
                  : {}),
              },
            });
            // Re-point any analyses from the anonymous Business to the user's Business
            await prisma.analysis.updateMany({
              where: { businessId: existingBiz.id },
              data: { businessId: duplicateBiz.id, userId: user.id, anonymousToken: null },
            });
            // Delete the orphaned anonymous Business
            await prisma.business.delete({ where: { id: existingBiz.id } }).catch(() => {});
            existingBiz = duplicateBiz;
          } else {
            // Claim: set userId, clear anonymousToken
            existingBiz = await prisma.business.update({
              where: { id: existingBiz.id },
              data: { userId: user.id, anonymousToken: null },
            });
          }

          // Claim all analyses that share this anonymousToken
          await prisma.analysis.updateMany({
            where: { anonymousToken },
            data: { userId: user.id, anonymousToken: null },
          });

          console.log(`[register] Business claimed: ${existingBiz.id} (tombstoneId=${existingBiz.tombstoneBusinessId})`);

          // Auto-grant starter credits
          try {
            const { grantStarterCredits } = await import('@/lib/credits');
            const starterResult = await grantStarterCredits(existingBiz.id, { userId: user.id });
            if (starterResult.success && !starterResult.alreadyCharged) {
              console.log(`[register] Starter credits granted to business ${existingBiz.id}`);
            }
          } catch (creditErr: any) {
            console.error('[register] Starter credit grant error (non-fatal):', creditErr?.message);
          }
        } else if (analysisId) {
          // Fallback: no anonymousToken or token didn't match — use legacy analysisId flow
          const analysis = await prisma.analysis.update({
            where: { id: analysisId },
            data: { userId: user.id, anonymousToken: null },
          });

          if (analysis?.websiteUrl) {
            // Check if analysis already has a linked Business (it should now)
            if (analysis.businessId) {
              // Claim the linked Business
              const linkedBiz = await prisma.business.findUnique({ where: { id: analysis.businessId } });
              if (linkedBiz && !linkedBiz.userId) {
                await prisma.business.update({
                  where: { id: linkedBiz.id },
                  data: { userId: user.id, anonymousToken: null },
                });
                console.log(`[register] Claimed linked Business ${linkedBiz.id} via analysisId`);
              }
            } else {
              // Legacy: no linked Business — upsert one
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
                  tombstoneBusinessId: analysis.tombstoneBusinessId ?? null,
                  tombstoneBusinessUuid: analysis.tombstoneBusinessUuid ?? null,
                },
                update: {
                  ...(analysis.businessName ? { businessName: analysis.businessName } : {}),
                  ...(analysis.tombstoneBusinessId ? { tombstoneBusinessId: analysis.tombstoneBusinessId } : {}),
                  ...(analysis.tombstoneBusinessUuid ? { tombstoneBusinessUuid: analysis.tombstoneBusinessUuid } : {}),
                },
              });
              await prisma.analysis.update({
                where: { id: analysisId },
                data: { businessId: biz.id },
              });
              console.log(`[register] Business upserted (legacy): ${biz.id} for user ${user.id}`);
            }
          }
        }
      } catch (linkErr: any) {
        console.error('[register] Analysis/Business claim error (non-fatal):', linkErr?.message);
      }
    }

    // Create GHL contact under MASTER account for CRM tracking (fire and forget)
    createGHLContact(email, undefined, 'master').catch(() => {});

    // Send confirmation email via Abacus notification system
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    const confirmLink = `${baseUrl}/confirm?token=${confirmationToken}`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563EB; margin: 0;">Launch OS</h1>
        </div>
        <h2 style="color: #1E293B;">Confirm Your Email</h2>
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hi there!</p>
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">Click the button below to confirm your email and download your <strong>3 free ads</strong>:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${confirmLink}" style="background-color: #2563EB; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">Confirm My Email</a>
        </div>
        <p style="color: #94A3B8; font-size: 14px;">If the button doesn't work, copy and paste this link:<br/>${confirmLink}</p>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;"/>
        <p style="color: #94A3B8; font-size: 12px; text-align: center;">Thanks,<br/>The Launch OS Team</p>
      </div>
    `;

    let emailSent = false;
    try {
      emailSent = await sendEmail({
        to: email,
        subject: 'Confirm your email - Launch OS',
        html: htmlBody,
        fromName: 'Launch OS',
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
