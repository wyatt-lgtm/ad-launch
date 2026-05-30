export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createSocialMissions } from '@/lib/tombstone';

/**
 * POST /api/social/generate
 * Accepts a Clark Kent scout brief and sends it to Tombstone's creative workflow.
 * Creates a GenerationRun immediately for traceability, then dispatches to Tombstone.
 *
 * Body: { scoutBrief: ScoutBrief, businessId?: string, analysisId?: string, clickedAt?: string }
 */
export async function POST(req: NextRequest) {
  const requestReceivedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await req.json();
    const { scoutBrief, businessId, analysisId, clickedAt } = body;

    if (!scoutBrief?.scoutSummary && !scoutBrief?.stories?.length) {
      return NextResponse.json({ error: 'Scout brief with scoutSummary or stories is required' }, { status: 400 });
    }

    const contentSourceMode = scoutBrief.contentSourceMode || 'local_plus_interests';

    // Extract story metadata for the generation run
    const rawStories: any[] = scoutBrief.stories || [];
    const MAX_POSTS = 3;
    const stories = rawStories.slice(0, MAX_POSTS);
    const storyTitles = stories.map((s: any) => s.headline || s.title || 'Untitled');
    const storySources = stories.map((s: any) => s.source || '');
    const storyLinks = stories.map((s: any) => s.link || '');

    // Create GenerationRun IMMEDIATELY so there is a traceable record
    const generationRun = await prisma.generationRun.create({
      data: {
        userId,
        businessId: businessId || null,
        status: 'submitted',
        selectedStoryTitles: storyTitles,
        selectedStorySources: storySources,
        selectedStoryLinks: storyLinks,
        storyCount: stories.length,
        clickedAt: clickedAt ? new Date(clickedAt) : new Date(requestReceivedAt),
      },
    });

    const runCreatedAt = Date.now();
    const clickToRunMs = runCreatedAt - (clickedAt ? new Date(clickedAt).getTime() : requestReceivedAt);
    console.log(`[social/generate] GenerationRun ${generationRun.id} created in ${clickToRunMs}ms`);

    // Resolve website URL — prefer businessId lookup, then analysis, then fallback
    let websiteUrl: string | null = null;
    let resolvedAnalysisId = analysisId || null;

    if (businessId) {
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
        select: { websiteUrl: true, userId: true },
      });
      if (biz && biz.userId === userId) {
        websiteUrl = biz.websiteUrl;
      }
    }

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

    if (!websiteUrl) {
      const biz = await prisma.business.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { websiteUrl: true },
      });
      if (biz) websiteUrl = biz.websiteUrl;
    }

    if (!websiteUrl) {
      // Mark generation run as failed
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: { status: 'failed', failStep: 'resolve_website', failError: 'No website URL found', failedAt: new Date() },
      });
      return NextResponse.json(
        { error: 'No website URL found. Complete a business analysis first.', generationRunId: generationRun.id },
        { status: 400 }
      );
    }

    console.log(`[social/generate] businessId=${businessId || 'none'} mode=${contentSourceMode} url=${websiteUrl} stories=${stories.length} (raw=${rawStories.length}, max=${MAX_POSTS}) runId=${generationRun.id}`);

    // Send to Tombstone creative workflow
    const result = await createSocialMissions(websiteUrl, scoutBrief.scoutSummary || '', {
      contentSourceMode,
      stories,
      businessId: businessId || undefined,
    });

    if (!result.success) {
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: { status: 'failed', failStep: 'tombstone_dispatch', failError: 'Failed to create Tombstone workflow', failedAt: new Date() },
      });
      return NextResponse.json(
        { error: 'Failed to create social content mission in Tombstone', generationRunId: generationRun.id },
        { status: 502 }
      );
    }

    const workflowCreatedAt = new Date();
    const socialMissionId = result.workflowIds.join(',');

    // Update generation run with workflow info
    await prisma.generationRun.update({
      where: { id: generationRun.id },
      data: {
        status: 'workflow_created',
        workflowIds: result.workflowIds,
        tombstoneTaskIds: result.allTaskIds.map(String),
        workflowCreatedAt,
      },
    });

    // Store social mission ID on the analysis if we have one
    if (resolvedAnalysisId) {
      await prisma.analysis.update({
        where: { id: resolvedAnalysisId },
        data: { socialMissionId },
      });
    }

    const totalDispatchMs = Date.now() - requestReceivedAt;
    console.log(`[social/generate] Social mission created: ${socialMissionId} (${result.allTaskIds.length} tasks) mode=${contentSourceMode} runId=${generationRun.id} dispatchMs=${totalDispatchMs}`);

    return NextResponse.json({
      success: true,
      socialMissionId,
      taskCount: result.allTaskIds.length,
      workflowIds: result.workflowIds,
      contentSourceMode,
      generationRunId: generationRun.id,
      timing: {
        clickToRunCreatedMs: clickToRunMs,
        runToWorkflowCreatedMs: workflowCreatedAt.getTime() - runCreatedAt,
        totalDispatchMs,
      },
    });
  } catch (error: any) {
    console.error('Social generate error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}