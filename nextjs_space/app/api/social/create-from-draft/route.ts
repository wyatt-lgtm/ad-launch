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

    // Store mission ID on the most recent analysis for polling
    const recentAnalysis = await prisma.analysis.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, socialMissionId: true },
    });

    if (recentAnalysis) {
      // Append to existing socialMissionId if present
      const existing = recentAnalysis.socialMissionId || '';
      const updated = existing ? `${existing},${socialMissionId}` : socialMissionId;
      await prisma.analysis.update({
        where: { id: recentAnalysis.id },
        data: { socialMissionId: updated },
      });
    }

    console.log(`[create-from-draft] Mission created: ${socialMissionId} (${result.allTaskIds.length} tasks)`);

    return NextResponse.json({
      success: true,
      socialMissionId,
      workflowIds: result.workflowIds,
      taskCount: result.allTaskIds.length,
      intent: 'copy_edit_user_post',
      source: 'user_written_post',
    });
  } catch (error: any) {
    console.error('Create from draft error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
