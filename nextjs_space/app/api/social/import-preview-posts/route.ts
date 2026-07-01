// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/social/import-preview-posts
 *
 * Surfaces the polished "Your Post Assets" preview cards (Ad records shown on the
 * /results/[id] page) into the Social Post Queue for a given business so they can
 * be reviewed / approved / published like any other queued post.
 *
 * Body: { businessId: string, analysisId?: string }
 *
 * Idempotent: each imported Ad is tracked via a synthetic tombstoneTaskId of the
 * form "ad:<adId>". Re-running skips Ads that were already imported.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const body = await req.json().catch(() => ({}));
    const businessId: string | undefined = body?.businessId || undefined;
    const analysisId: string | undefined = body?.analysisId || undefined;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    // Verify the business belongs to the current user.
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Collect the relevant analyses for this business.
    const analyses = await prisma.analysis.findMany({
      where: {
        businessId,
        ...(analysisId ? { id: analysisId } : {}),
      },
      select: { id: true },
    });
    const analysisIds = analyses.map((a) => a.id);
    if (analysisIds.length === 0) {
      return NextResponse.json({ imported: 0, skipped: 0, total: 0 });
    }

    // Fetch all ads for those analyses (newest first) and reduce to the latest
    // ad per lane — this mirrors exactly what the results page displays as the
    // three "Your Post Assets" cards (website / news / holiday).
    const ads = await prisma.ad.findMany({
      where: { analysisId: { in: analysisIds } },
      orderBy: { createdAt: 'desc' },
    });

    const normalizeLane = (lane?: string | null) => (lane === 'seasonal' ? 'holiday' : lane || null);
    const seenLanes = new Set<string>();
    const selectedAds: typeof ads = [];
    for (const ad of ads) {
      // Only import ads that actually have content to show.
      if (!ad.caption && !ad.headline && !ad.imageUrl && !ad.watermarkedUrl) continue;
      const lane = normalizeLane(ad.lane);
      const dedupeKey = lane || `fallback-${ad.imageUrl || ''}-${ad.headline || ''}`;
      if (seenLanes.has(dedupeKey)) continue;
      seenLanes.add(dedupeKey);
      selectedAds.push(ad);
    }

    if (selectedAds.length === 0) {
      return NextResponse.json({ imported: 0, skipped: 0, total: 0 });
    }

    // Dedup against posts already imported for this user (synthetic tombstoneTaskId).
    const candidateTaskIds = selectedAds.map((ad) => `ad:${ad.id}`);
    const existing = await prisma.socialPost.findMany({
      where: { userId, tombstoneTaskId: { in: candidateTaskIds } },
      select: { tombstoneTaskId: true },
    });
    const existingTaskIds = new Set(existing.map((p) => p.tombstoneTaskId));

    const toCreate = selectedAds.filter((ad) => !existingTaskIds.has(`ad:${ad.id}`));

    const laneSourceName = (lane?: string | null) => {
      const l = normalizeLane(lane);
      if (l === 'website') return 'Website / Brand';
      if (l === 'news') return 'Local News';
      if (l === 'holiday') return 'Upcoming Holiday';
      return 'Post Asset';
    };

    if (toCreate.length > 0) {
      await prisma.socialPost.createMany({
        data: toCreate.map((ad) => ({
          userId,
          businessId,
          analysisId: ad.analysisId,
          caption: ad.caption || ad.headline || '',
          hashtags: [],
          imageUrl: ad.imageUrl || ad.watermarkedUrl || null,
          platforms: [],
          postType: 'general',
          status: 'pending_approval',
          sourceType: normalizeLane(ad.lane) || undefined,
          sourceName: laneSourceName(ad.lane),
          tombstoneTaskId: `ad:${ad.id}`,
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({
      imported: toCreate.length,
      skipped: selectedAds.length - toCreate.length,
      total: selectedAds.length,
    });
  } catch (err: any) {
    console.error('[import-preview-posts] error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to import preview posts' }, { status: 500 });
  }
}
