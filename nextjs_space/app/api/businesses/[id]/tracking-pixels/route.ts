export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { validatePixelInput, logPixelAudit, sanitizeSnippetForDisplay } from '@/lib/tracking-pixels';

/** Whitelisted fields that can be written from the client. */
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

/** GET /api/businesses/[id]/tracking-pixels */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { business } = r;

  const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
  const pixels = await prisma.trackingPixel.findMany({
    where: { businessId: business.id, ...(includeArchived ? {} : { status: { not: 'archived' } }) },
    orderBy: { createdAt: 'desc' },
  });

  // Display custom snippets safely (escaped) so they never execute in the UI.
  const mapped = pixels.map((p) => ({
    ...p,
    scriptSnippetDisplay: sanitizeSnippetForDisplay(p.scriptSnippet),
  }));

  return NextResponse.json({ business: { id: business.id, name: business.businessName }, pixels: mapped });
}

/** POST /api/businesses/[id]/tracking-pixels */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;

  const body = await req.json().catch(() => ({}));
  const check = validatePixelInput(body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const data = pickFields(body);
  const pixel = await prisma.trackingPixel.create({
    data: {
      businessId: business.id,
      ...data,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    } as any,
  });

  await logPixelAudit({
    businessId: business.id,
    pixelId: pixel.id,
    action: 'created',
    details: { name: pixel.name, platform: pixel.platform },
    userId: user.id,
  });

  return NextResponse.json({ ok: true, pixel });
}
