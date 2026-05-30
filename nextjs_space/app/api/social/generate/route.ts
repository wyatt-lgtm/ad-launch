export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createSocialMissions } from '@/lib/tombstone';

/**
 * POST /api/social/generate
 *
 * Creates a GenerationRun IMMEDIATELY, then dispatches to Tombstone.
 * Returns generationRunId to the frontend before any long-running work.
 *
 * Hard failure guards:
 * - No generationRun created → fail visibly
 * - No workflowIds returned → fail visibly
 * - No taskIds returned → fail visibly
 * - Tombstone returns success but empty data → fail visibly
 *
 * Body: { scoutBrief, businessId?, analysisId?, clickedAt? }
 */
export async function POST(req: NextRequest) {
  const apiReceivedAt = new Date();
  const apiReceivedMs = apiReceivedAt.getTime();
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
    const clickedAtDate = clickedAt ? new Date(clickedAt) : apiReceivedAt;

    // Extract story metadata
    const rawStories: any[] = scoutBrief.stories || [];
    const MAX_POSTS = 3;
    const stories = rawStories.slice(0, MAX_POSTS);
    const storyTitles = stories.map((s: any) => s.headline || s.title || 'Untitled');
    const storySources = stories.map((s: any) => s.source || '');
    const storyLinks = stories.map((s: any) => s.link || '');

    // ── STEP 1: Create GenerationRun IMMEDIATELY ────────────────────────────
    let generationRun;
    try {
      generationRun = await prisma.generationRun.create({
        data: {
          userId,
          businessId: businessId || null,
          status: 'creating_workflow',
          selectedStoryTitles: storyTitles,
          selectedStorySources: storySources,
          selectedStoryLinks: storyLinks,
          storyCount: stories.length,
          clickedAt: clickedAtDate,
          apiReceivedAt,
        },
      });
    } catch (dbErr: any) {
      console.error('[social/generate] CRITICAL: Failed to create GenerationRun:', dbErr);
      return NextResponse.json(
        { error: 'Failed to create generation run record', detail: dbErr.message },
        { status: 500 }
      );
    }

    const runCreatedAt = Date.now();
    const clickToApiMs = apiReceivedMs - clickedAtDate.getTime();
    const apiToRunMs = runCreatedAt - apiReceivedMs;
    console.log(`[social/generate] GenerationRun ${generationRun.id} created | click_to_api=${clickToApiMs}ms api_to_run=${apiToRunMs}ms`);

    // ── STEP 2: Resolve website URL ─────────────────────────────────────────
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
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: { status: 'workflow_creation_failed', failStep: 'resolve_website', failError: 'No website URL found', failedAt: new Date() },
      });
      return NextResponse.json(
        { error: 'No website URL found. Complete a business analysis first.', generationRunId: generationRun.id, status: 'workflow_creation_failed' },
        { status: 400 }
      );
    }

    console.log(`[social/generate] businessId=${businessId || 'none'} mode=${contentSourceMode} url=${websiteUrl} stories=${stories.length} runId=${generationRun.id}`);

    // ── STEP 3: Create Tombstone workflow ────────────────────────────────────
    const workflowCreateStartedAt = new Date();
    await prisma.generationRun.update({
      where: { id: generationRun.id },
      data: { workflowCreateStartedAt },
    });

    let result;
    try {
      result = await createSocialMissions(websiteUrl, scoutBrief.scoutSummary || '', {
        contentSourceMode,
        stories,
        businessId: businessId || undefined,
      });
    } catch (tombstoneErr: any) {
      const failedAt = new Date();
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: 'workflow_creation_failed',
          failStep: 'tombstone_dispatch',
          failError: `Tombstone exception: ${tombstoneErr.message}`,
          failedAt,
        },
      });
      console.error(`[social/generate] Tombstone exception for runId=${generationRun.id}:`, tombstoneErr.message);
      return NextResponse.json(
        { error: 'Tombstone workflow creation threw an exception', generationRunId: generationRun.id, status: 'workflow_creation_failed' },
        { status: 502 }
      );
    }

    const workflowCreatedAt = new Date();
    const workflowCreateDurationMs = workflowCreatedAt.getTime() - workflowCreateStartedAt.getTime();

    // ── HARD FAILURE GUARD 1: No success flag ───────────────────────────────
    if (!result.success) {
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: 'workflow_creation_failed',
          failStep: 'tombstone_dispatch',
          failError: 'Tombstone returned success=false — no workflow created',
          failedAt: workflowCreatedAt,
          workflowCreatedAt,
        },
      });
      console.error(`[social/generate] FAILURE: Tombstone returned success=false for runId=${generationRun.id}`);
      return NextResponse.json(
        { error: 'Failed to create Tombstone workflow', generationRunId: generationRun.id, status: 'workflow_creation_failed' },
        { status: 502 }
      );
    }

    // ── HARD FAILURE GUARD 2: No workflow IDs ───────────────────────────────
    if (!result.workflowIds || result.workflowIds.length === 0) {
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: 'workflow_creation_failed',
          failStep: 'tombstone_no_workflows',
          failError: 'Tombstone returned success but no workflowIds',
          failedAt: workflowCreatedAt,
          workflowCreatedAt,
        },
      });
      console.error(`[social/generate] FAILURE: No workflowIds returned for runId=${generationRun.id}`);
      return NextResponse.json(
        { error: 'Tombstone returned success but no workflow was created', generationRunId: generationRun.id, status: 'workflow_creation_failed' },
        { status: 502 }
      );
    }

    // ── HARD FAILURE GUARD 3: No task IDs ───────────────────────────────────
    if (!result.allTaskIds || result.allTaskIds.length === 0) {
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: 'workflow_creation_failed',
          failStep: 'tombstone_no_tasks',
          failError: `Tombstone returned ${result.workflowIds.length} workflow(s) but 0 tasks`,
          failedAt: workflowCreatedAt,
          workflowIds: result.workflowIds,
          workflowCreatedAt,
        },
      });
      console.error(`[social/generate] FAILURE: No taskIds returned for runId=${generationRun.id} wf=${result.workflowIds}`);
      return NextResponse.json(
        { error: 'Tombstone created workflow but no tasks', generationRunId: generationRun.id, status: 'workflow_creation_failed', workflowIds: result.workflowIds },
        { status: 502 }
      );
    }

    // ── SUCCESS: Update GenerationRun with workflow info ─────────────────────
    const socialMissionId = result.workflowIds.join(',');
    const firstTaskId = String(result.allTaskIds[0]);

    await prisma.generationRun.update({
      where: { id: generationRun.id },
      data: {
        status: 'workflow_running',
        workflowIds: result.workflowIds,
        tombstoneTaskIds: result.allTaskIds.map(String),
        firstTaskId,
        workflowCreatedAt,
      },
    });

    // Store social mission ID on the analysis if we have one
    if (resolvedAnalysisId) {
      await prisma.analysis.update({
        where: { id: resolvedAnalysisId },
        data: { socialMissionId },
      }).catch(() => {}); // non-critical
    }

    const totalDispatchMs = Date.now() - apiReceivedMs;
    console.log(
      `[social/generate] SUCCESS runId=${generationRun.id} ` +
      `workflows=${result.workflowIds.length} tasks=${result.allTaskIds.length} ` +
      `click_to_api=${clickToApiMs}ms api_to_run=${apiToRunMs}ms ` +
      `workflow_create=${workflowCreateDurationMs}ms total_dispatch=${totalDispatchMs}ms`
    );

    return NextResponse.json({
      success: true,
      generationRunId: generationRun.id,
      status: 'workflow_running',
      socialMissionId,
      taskCount: result.allTaskIds.length,
      workflowIds: result.workflowIds,
      firstTaskId,
      contentSourceMode,
      timing: {
        clickToApiMs,
        apiToRunCreatedMs: apiToRunMs,
        workflowCreateDurationMs,
        totalDispatchMs,
      },
    });
  } catch (error: any) {
    console.error('[social/generate] Unhandled error:', error);
    return NextResponse.json({ error: error.message, status: 'error' }, { status: 500 });
  }
}
