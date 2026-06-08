export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createDraftPolishMission } from '@/lib/tombstone';

/**
 * POST /api/social/create-from-draft
 *
 * Accepts a user-written draft post and sends it to Tombstone for
 * copy editing and optional art generation.
 *
 * Body: {
 *   draftText: string (required)
 *   platform?: string
 *   tone?: string
 *   cta?: string
 *   offer?: string
 *   artDirection?: string
 *   generateArt?: boolean (default true)
 *   businessId?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await req.json();
    const {
      draftText,
      platform,
      tone,
      cta,
      offer,
      artDirection,
      generateArt = true,
      businessId,
    } = body;

    // Validate required field
    if (!draftText || typeof draftText !== 'string' || draftText.trim().length === 0) {
      return NextResponse.json(
        { error: 'Draft post text is required' },
        { status: 400 }
      );
    }

    // Resolve website URL from business or recent analysis
    let websiteUrl: string | null = null;
    let resolvedBusinessId = businessId || null;

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
      const biz = await prisma.business.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, websiteUrl: true },
      });
      if (biz) {
        websiteUrl = biz.websiteUrl;
        if (!resolvedBusinessId) resolvedBusinessId = biz.id;
      }
    }

    if (!websiteUrl) {
      return NextResponse.json(
        { error: 'No business website URL found. Complete a business analysis first.' },
        { status: 400 }
      );
    }

    console.log(`[create-from-draft] userId=${userId} business=${resolvedBusinessId} art=${generateArt} platform=${platform || 'any'} tone=${tone || 'default'}`);

    // Send to Tombstone for copy editing + optional art
    const result = await createDraftPolishMission(websiteUrl, draftText.trim(), {
      platform: platform || undefined,
      tone: tone || undefined,
      cta: cta || undefined,
      offer: offer || undefined,
      artDirection: artDirection || undefined,
      generateArt,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to start creative workflow in Tombstone' },
        { status: 502 }
      );
    }

    const socialMissionId = result.workflowIds.join(',');

    // Store mission ID on the correct business's analysis for polling
    // Priority: analysis for the selected business > most recent analysis
    let targetAnalysis = resolvedBusinessId
      ? await prisma.analysis.findFirst({
          where: { userId, businessId: resolvedBusinessId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, socialMissionId: true },
        })
      : null;

    if (!targetAnalysis) {
      // Fallback: most recent analysis (shouldn't happen if business is properly selected)
      targetAnalysis = await prisma.analysis.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, socialMissionId: true },
      });
      if (targetAnalysis) {
        console.warn(`[create-from-draft] No analysis for business ${resolvedBusinessId}, falling back to most recent analysis ${targetAnalysis.id}`);
      }
    }

    if (targetAnalysis) {
      // Append to existing socialMissionId if present
      const existing = targetAnalysis.socialMissionId || '';
      const updated = existing ? `${existing},${socialMissionId}` : socialMissionId;
      await prisma.analysis.update({
        where: { id: targetAnalysis.id },
        data: { socialMissionId: updated },
      });
      console.log(`[create-from-draft] Stored workflow ${socialMissionId} on analysis ${targetAnalysis.id} (business=${resolvedBusinessId})`);
    }

    // Create a GenerationRun so the poll route can map this workflow to the correct business
    const now = new Date();
    const generationRun = await prisma.generationRun.create({
      data: {
        userId,
        businessId: resolvedBusinessId,
        status: 'polling',
        workflowIds: result.workflowIds,
        tombstoneTaskIds: result.allTaskIds.map(String),
        clickedAt: now,
        runCreatedAt: now,
        workflowCreatedAt: now,
      },
    });
    console.log(`[create-from-draft] Created GenerationRun ${generationRun.id} for business=${resolvedBusinessId} workflows=${socialMissionId}`);

    console.log(`[create-from-draft] Mission created: ${socialMissionId} (${result.allTaskIds.length} tasks)`);

    return NextResponse.json({
      success: true,
      socialMissionId,
      workflowIds: result.workflowIds,
      taskCount: result.allTaskIds.length,
      generationRunId: generationRun.id,
      intent: 'copy_edit_user_post',
      source: 'user_written_post',
    });
  } catch (error: any) {
    console.error('Create from draft error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
