export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { validatePixelInput, logPixelAudit } from '@/lib/tracking-pixels';

const PIXEL_FIELDS = [
  'name', 'platform', 'pixelType', 'trackingMethod', 'pixelId', 'scriptSnippet',
  'placement', 'scope', 'status', 'consentRequired', 'consentCategory',
  'firesBeforeConsent', 'regionRulesJson', 'cookieBannerRequired',
  'ga4MeasurementId', 'analyticsStreamId', 'analyticsPropertyId',
  'defaultPageViewEnabled', 'enhancedMeasurementEnabled', 'googleTagId',
  'googleAdsConversionId', 'googleAdsConversionLabel', 'gtmContainerId',
  'metaPixelId', 'metaDatasetId', 'metaConversionsApiEnabled', 'tiktokPixelId',
  'tiktokEventsApiEnabled', 'linkedinPartnerId', 'linkedinConversionId',
  'bingUetTagId', 'choozleAdvertiserId', 'choozlePixelId', 'choozleConversionId',
  'serverEventEnabled', 'deduplicationKeyStrategy', 'externalEventIdField',
  'hashedEmailEnabled', 'hashedPhoneEnabled', 'enhancedConversionsEnabled',
  'testModeEnabled',
] as const;

function pickFields(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of PIXEL_FIELDS) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  if (typeof out.name === 'string') out.name = out.name.trim();
  return out;
}

async function loadOwnedPixel(businessId: string, pixelId: string) {
  return prisma.trackingPixel.findFirst({ where: { id: pixelId, businessId } });
}

/** PATCH /api/businesses/[id]/tracking-pixels/[pixelId] */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; pixelId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;

  const existing = await loadOwnedPixel(business.id, params.pixelId);
  if (!existing) return NextResponse.json({ error: 'Pixel not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Action shortcuts (verify / disable / enable / archive)
  const action = body.action as string | undefined;
  if (action) {
    let updateData: Record<string, any> = {};
    let auditAction = 'updated';
    if (action === 'verify') {
      updateData = { verificationStatus: 'verified', verifiedAt: new Date(), lastVerifiedUrl: body.lastVerifiedUrl || existing.lastVerifiedUrl, lastError: null, status: existing.status === 'needs_verification' ? 'active' : existing.status };
      auditAction = 'verified';
    } else if (action === 'fail_verification') {
      updateData = { verificationStatus: 'failed', lastError: body.error || 'Verification failed' };
      auditAction = 'failed_verification';
    } else if (action === 'disable') {
      updateData = { status: 'inactive' };
      auditAction = 'disabled';
    } else if (action === 'enable') {
      updateData = { status: 'active' };
      auditAction = 'enabled';
    } else if (action === 'archive') {
      updateData = { status: 'archived', archivedAt: new Date() };
      auditAction = 'archived';
    } else if (action === 'test_event') {
      updateData = { lastEventSeenAt: new Date() };
      auditAction = 'test_event_sent';
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    const updated = await prisma.trackingPixel.update({
      where: { id: existing.id },
      data: { ...updateData, updatedByUserId: user.id },
    });
    await logPixelAudit({ businessId: business.id, pixelId: existing.id, action: auditAction, userId: user.id });
    return NextResponse.json({ ok: true, pixel: updated });
  }

  // Full field update
  if (body.name !== undefined || body.platform !== undefined) {
    const merged = { name: existing.name, platform: existing.platform, ...body };
    const check = validatePixelInput(merged);
    if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const data = pickFields(body);
  const updated = await prisma.trackingPixel.update({
    where: { id: existing.id },
    data: { ...data, version: { increment: 1 }, updatedByUserId: user.id },
  });

  await logPixelAudit({ businessId: business.id, pixelId: existing.id, action: 'updated', details: { fields: Object.keys(data) }, userId: user.id });

  return NextResponse.json({ ok: true, pixel: updated });
}

/** DELETE /api/businesses/[id]/tracking-pixels/[pixelId] — soft-archive by default. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; pixelId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;

  const existing = await loadOwnedPixel(business.id, params.pixelId);
  if (!existing) return NextResponse.json({ error: 'Pixel not found' }, { status: 404 });

  const hard = req.nextUrl.searchParams.get('hard') === '1';
  if (hard) {
    await prisma.trackingPixel.delete({ where: { id: existing.id } });
    await logPixelAudit({ businessId: business.id, pixelId: existing.id, action: 'archived', details: { hardDelete: true }, userId: user.id });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const updated = await prisma.trackingPixel.update({
    where: { id: existing.id },
    data: { status: 'archived', archivedAt: new Date(), updatedByUserId: user.id },
  });
  await logPixelAudit({ businessId: business.id, pixelId: existing.id, action: 'archived', userId: user.id });
  return NextResponse.json({ ok: true, pixel: updated });
}
