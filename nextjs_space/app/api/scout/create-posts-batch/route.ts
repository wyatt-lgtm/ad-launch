export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createScoutStoryMission } from '@/lib/tombstone';
import { checkCredits, CREDIT_COSTS } from '@/lib/credits';

/**
 * POST /api/scout/create-posts-batch
 *
 * Authenticated endpoint: create 1-3 posts from selected stories.
 * Requires login. For the Review All Stories page.
 *
 * Body: { scoutReportId: string, storyIds: string[] }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const { scoutReportId, storyIds } = body;

  if (!scoutReportId || !Array.isArray(storyIds) || storyIds.length === 0) {
    return NextResponse.json({ error: 'scoutReportId and storyIds are required' }, { status: 400 });
  }

  if (storyIds.length > 3) {
    return NextResponse.json({ error: 'Maximum 3 stories can be selected at once' }, { status: 400 });
  }

  // Verify report ownership
  const report = await prisma.scoutReport.findUnique({
    where: { id: scoutReportId },
    include: {
      stories: { where: { id: { in: storyIds } } },
      business: { select: { id: true, websiteUrl: true, businessName: true, tombstoneBusinessId: true } },
    },
  });

  if (!report || report.userId !== user.id) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  if (!report.business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  // Check for active generation workflows on this business
  const activeCount = await prisma.postPackage.count({
    where: { businessId: report.business.id, status: 'generating' },
  });

  if (activeCount > 0) {
    return NextResponse.json({
      error: 'Your previous post is still being created. Please wait for it to complete.',
    }, { status: 409 });
  }

  // Credit check: need 1 credit per story
  const totalCost = report.stories.length * CREDIT_COSTS.IMAGE_POST;
  const creditCheck = await checkCredits(report.business.id, totalCost);
  if (!creditCheck.allowed) {
    return NextResponse.json({
      error: `Not enough credits. You need ${totalCost} credit${totalCost > 1 ? 's' : ''} but have ${creditCheck.balance}.`,
      balance: creditCheck.balance,
      required: totalCost,
    }, { status: 402 });
  }

  // Create PostPackages and launch workflows
  const results: { storyId: string; packageId: string; workflowId: string | null; success: boolean }[] = [];

  for (const story of report.stories) {
    const postPackage = await prisma.postPackage.create({
      data: {
        userId: user.id,
        businessId: report.business.id,
        storyId: story.id,
        scoutReportId: report.id,
        source: 'app_review',
        status: 'generating',
        storyTitle: story.title,
        storySource: story.source,
        storyUrl: story.sourceUrl,
        storySummary: story.summary,
        suggestedAngle: story.suggestedAngle,
      },
    });

    const missionResult = await createScoutStoryMission(
      report.business.websiteUrl,
      {
        title: story.title,
        source: story.source,
        sourceUrl: story.sourceUrl,
        summary: story.summary,
        relevance: story.relevance,
        suggestedAngle: story.suggestedAngle,
        sourceType: story.sourceType,
      },
      {
        businessId: report.business.id,
        userId: user.id,
        scoutReportId: report.id,
        storyId: story.id,
        postPackageId: postPackage.id,
        businessName: report.business.businessName || undefined,
        tombstoneBusinessId: report.business.tombstoneBusinessId,
      },
    );

    if (missionResult.workflowId) {
      await prisma.postPackage.update({
        where: { id: postPackage.id },
        data: { workflowId: missionResult.workflowId },
      });
    } else {
      await prisma.postPackage.update({
        where: { id: postPackage.id },
        data: { status: 'rejected' },
      });
    }

    results.push({
      storyId: story.id,
      packageId: postPackage.id,
      workflowId: missionResult.workflowId,
      success: missionResult.success,
    });

    // Brief pause between commands
    if (report.stories.indexOf(story) < report.stories.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`[create-posts-batch] Created ${results.filter(r => r.success).length}/${results.length} workflows`);

  return NextResponse.json({
    success: results.some(r => r.success),
    results,
  });
}
