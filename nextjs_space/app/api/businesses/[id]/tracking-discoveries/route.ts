export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import {
  reconcileDiscovery,
  flagConfiguredButNotFound,
  createTrackingGapRecommendations,
  type DetectedPixelInput,
} from '@/lib/pixel-discovery';

/** GET /api/businesses/[id]/tracking-discoveries — “Detected on Website” list. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const discoveries = await prisma.trackingPixelDiscovery.findMany({
    where: { businessId: r.business.id },
    orderBy: [{ confidenceScore: 'desc' }, { lastSeenAt: 'desc' }],
  });
  return NextResponse.json({ discoveries });
}

/**
 * POST /api/businesses/[id]/tracking-discoveries
 * Ingest detected pixels from Deep Research (Bridger). Reconciles each against
 * existing TrackingPixel config. Never injects/edits scripts on the website.
 * Body: { detected: DetectedPixelInput[], sourceUrl?, gaps?: {...},
 *         flagMissing?: boolean }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;
  const body = await req.json().catch(() => ({}));
  const detected: DetectedPixelInput[] = Array.isArray(body.detected) ? body.detected : [];

  const results = [];
  const detectedIds: string[] = [];
  for (const d of detected) {
    const input: DetectedPixelInput = { ...d, sourceUrl: d.sourceUrl ?? body.sourceUrl ?? null };
    if (d.detectedId) detectedIds.push(d.detectedId);
    results.push(await reconcileDiscovery(businessId, input, {
      createdTaskId: body.createdTaskId ?? null,
      createdByAgent: body.createdByAgent ?? 'jim_bridger',
      userId: r.user.id,
    }));
  }

  let flagged = 0;
  if (body.flagMissing) flagged = await flagConfiguredButNotFound(businessId, detectedIds);

  let gapRecs = 0;
  if (body.gaps) gapRecs = await createTrackingGapRecommendations(businessId, body.gaps);

  return NextResponse.json({ ok: true, results, flaggedNotFound: flagged, gapRecommendations: gapRecs });
}
