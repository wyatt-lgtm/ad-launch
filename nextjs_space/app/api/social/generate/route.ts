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
 * Body: { scoutBrief: ScoutBrief, analysisId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await req.json();
    const { scoutBrief, analysisId } = body;

    if (!scoutBrief?.scoutSummary) {
      return NextResponse.json({ error: 'Scout brief with scoutSummary is required' }, { status: 400 });
    }

    // Resolve website URL from analysis record (Clark Kent no longer carries business context)
    let websiteUrl: string | null = null;
    let resolvedAnalysisId = analysisId || null;

    // Always resolve from analysis DB — scout brief only has local intel (RSS, events, trade area)
    const recentAnalysis = await prisma.analysis.findFirst({
      where: analysisId ? { id: analysisId, userId } : { userId, geoConfirmed: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, websiteUrl: true },
    });
    if (recentAnalysis) {
      websiteUrl = recentAnalysis.websiteUrl;
      resolvedAnalysisId = resolvedAnalysisId || recentAnalysis.id;
    }

    if (!websiteUrl) {
      return NextResponse.json(
        { error: 'No website URL found. Complete a business analysis first.' },
        { status: 400 }
      );
    }

    // Send to Tombstone creative workflow
    const result = await createSocialMissions(websiteUrl, scoutBrief.scoutSummary);

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

    console.log(`[social/generate] Social mission created: ${socialMissionId} (${result.allTaskIds.length} tasks)`);

    return NextResponse.json({
      success: true,
      socialMissionId,
      taskCount: result.allTaskIds.length,
      workflowIds: result.workflowIds,
    });
  } catch (error: any) {
    console.error('Social generate error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
