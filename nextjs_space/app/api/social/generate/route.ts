export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createSocialMissions } from '@/lib/tombstone';

/**
 * POST /api/social/generate
 * Accepts a Clark Kent scout brief and sends it to Tombstone's creative workflow.
 * Zig Ziglar → Ogilvy → Don Draper → Andy Warhol → Claude Hopkins
 * will produce social posts with artwork.
 *
 * Body: { scoutBrief: ScoutBrief, businessId?: string, analysisId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await req.json();
    const { scoutBrief, businessId, analysisId } = body;

    if (!scoutBrief?.scoutSummary && !scoutBrief?.stories?.length) {
      return NextResponse.json({ error: 'Scout brief with scoutSummary or stories is required' }, { status: 400 });
    }

    const contentSourceMode = scoutBrief.contentSourceMode || 'local_plus_interests';

    // Resolve website URL — prefer businessId lookup, then analysis, then fallback
    let websiteUrl: string | null = null;
    let resolvedAnalysisId = analysisId || null;

    // Try businessId first
    if (businessId) {
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
        select: { websiteUrl: true, userId: true },
      });
      if (biz && biz.userId === userId) {
        websiteUrl = biz.websiteUrl;
      }
    }

    // Try analysis DB — prefer geoConfirmed, then fall back to any analysis
    if (!websiteUrl) {
      const recentAnalysis = await prisma.analysis.findFirst({
        where: analysisId
          ? { id: analysisId, userId }
          : { userId, geoConfirmed: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, websiteUrl: true },
      }) ?? (analysisId ? null : await prisma.analysis.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, websiteUrl: true },
      }));
      if (recentAnalysis) {
        websiteUrl = websiteUrl || recentAnalysis.websiteUrl;
        resolvedAnalysisId = resolvedAnalysisId || recentAnalysis.id;
      }
    }

    // Fallback: look up from user's Business records
    if (!websiteUrl) {
      const biz = await prisma.business.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { websiteUrl: true },
      });
      if (biz) websiteUrl = biz.websiteUrl;
    }

    if (!websiteUrl) {
      return NextResponse.json(
        { error: 'No website URL found. Complete a business analysis first.' },
        { status: 400 }
      );
    }

    // Enforce max 3 posts — clamp stories array server-side regardless of what frontend sends
    const MAX_POSTS = 3;
    const rawStories: any[] = scoutBrief.stories || [];
    const stories = rawStories.slice(0, MAX_POSTS);

    console.log(`[social/generate] businessId=${businessId || 'none'} mode=${contentSourceMode} url=${websiteUrl} stories=${stories.length} (raw=${rawStories.length}, max=${MAX_POSTS})`);

    // Send to Tombstone creative workflow — one command per story
    const result = await createSocialMissions(websiteUrl, scoutBrief.scoutSummary || '', {
      contentSourceMode,
      stories,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to create social content mission in Tombstone' },
        { status: 502 }
      );
    }

    const socialMissionId = result.workflowIds.join(',');

    // Store social mission ID on the analysis if we have one
    if (resolvedAnalysisId) {
      await prisma.analysis.update({
        where: { id: resolvedAnalysisId },
        data: { socialMissionId },
      });
    }

    console.log(`[social/generate] Social mission created: ${socialMissionId} (${result.allTaskIds.length} tasks) mode=${contentSourceMode}`);

    return NextResponse.json({
      success: true,
      socialMissionId,
      taskCount: result.allTaskIds.length,
      workflowIds: result.workflowIds,
      contentSourceMode,
    });
  } catch (error: any) {
    console.error('Social generate error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
