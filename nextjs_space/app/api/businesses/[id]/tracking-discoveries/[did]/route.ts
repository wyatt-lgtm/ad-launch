export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { logPixelAudit } from '@/lib/tracking-pixels';
import { idFieldForPlatform } from '@/lib/pixel-discovery';

/**
 * PATCH /api/businesses/[id]/tracking-discoveries/[did]
 * action: import_confirm | match_existing | ignore | verify_again
 * Imports/confirms create draft/needs_verification TrackingPixel records only
 * — never auto-active. No website scripts are modified.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; did: string } },
) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;
  const discovery = await prisma.trackingPixelDiscovery.findFirst({
    where: { id: params.did, businessId },
  });
  if (!discovery) return NextResponse.json({ error: 'Discovery not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  if (action === 'ignore') {
    const updated = await prisma.trackingPixelDiscovery.update({
      where: { id: discovery.id },
      data: { status: 'ignored' } as any,
    });
    return NextResponse.json({ ok: true, discovery: updated });
  }

  if (action === 'verify_again') {
    const updated = await prisma.trackingPixelDiscovery.update({
      where: { id: discovery.id },
      data: { status: 'needs_review', lastSeenAt: new Date() } as any,
    });
    return NextResponse.json({ ok: true, discovery: updated });
  }

  if (action === 'match_existing') {
    if (!body.trackingPixelId) return NextResponse.json({ error: 'Missing trackingPixelId' }, { status: 400 });
    const pixel = await prisma.trackingPixel.findFirst({
      where: { id: body.trackingPixelId, businessId },
      select: { id: true },
    });
    if (!pixel) return NextResponse.json({ error: 'Tracking pixel not found' }, { status: 404 });
    const updated = await prisma.trackingPixelDiscovery.update({
      where: { id: discovery.id },
      data: { status: 'matched_existing_config', matchedTrackingPixelId: pixel.id } as any,
    });
    return NextResponse.json({ ok: true, discovery: updated });
  }

  if (action === 'import_confirm') {
    // Create a draft / needs_verification pixel (never auto-active).
    if (discovery.matchedTrackingPixelId) {
      return NextResponse.json({ error: 'Already linked to a tracking pixel' }, { status: 409 });
    }
    const idField = idFieldForPlatform(discovery.platform);
    const created = await prisma.trackingPixel.create({
      data: {
        businessId,
        name: `${discovery.platform} (imported from website)`,
        platform: discovery.platform,
        pixelType: discovery.pixelType || 'base_pixel',
        pixelId: discovery.detectedId,
        [idField]: discovery.detectedId,
        status: 'needs_verification',
        verificationStatus: 'pending',
        manualSetupRequired: false,
        installStatus: 'detected_on_site',
        setupStatus: 'needs_customer_action',
      } as any,
    });
    const updated = await prisma.trackingPixelDiscovery.update({
      where: { id: discovery.id },
      data: { status: 'matched_existing_config', matchedTrackingPixelId: created.id } as any,
    });
    await logPixelAudit({
      businessId,
      pixelId: created.id,
      action: 'created',
      details: { source: 'discovery_import', discoveryId: discovery.id },
      userId: r.user.id,
    });
    return NextResponse.json({ ok: true, discovery: updated, pixel: created });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
