export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyMagicToken } from '@/lib/magic-token';
import { createScoutStoryMission } from '@/lib/tombstone';
import { canStartGeneration, CREDIT_COSTS } from '@/lib/credits';

/**
 * GET /api/scout/create-post?token=xxx
 *
 * Magic-link endpoint: validates token, checks for active workflows,
 * creates exactly one Tombstone workflow for one story.
 * Redirects to confirmation or error page.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const appUrl = process.env.NEXTAUTH_URL || 'https://connect.launchmarketing.com';

  if (!token) {
    console.warn('[create-post] No token provided');
    return NextResponse.redirect(`${appUrl}/scout/expired?reason=missing_token`);
  }

  // Verify the magic token
  const result = await verifyMagicToken(token);
  if (!result.valid || !result.payload) {
    console.warn(`[create-post] Token validation failed: ${result.error}`);
    if (result.error === 'expired') {
      return NextResponse.redirect(`${appUrl}/scout/expired?reason=expired`);
    }
    if (result.error === 'already_used') {
      return NextResponse.redirect(`${appUrl}/scout/expired?reason=already_used`);
    }
    return NextResponse.redirect(`${appUrl}/scout/expired?reason=invalid`);
  }

  const { userId, businessId, storyId, scoutReportId } = result.payload;

  if (!storyId) {
    console.error('[create-post] Token has no storyId');
    return NextResponse.redirect(`${appUrl}/scout/expired?reason=invalid`);
  }

  try {
    // Check for active workflow on this business
    const activePackage = await prisma.postPackage.findFirst({
      where: { businessId, status: 'generating' },
      select: { id: true },
    });
    if (activePackage) {
      console.log(`[create-post] Active workflow exists for business ${businessId}`);
      return NextResponse.redirect(`${appUrl}/scout/confirm?status=active_workflow`);
    }

    // Credit check
    const creditCheck = await canStartGeneration(businessId, CREDIT_COSTS.IMAGE_POST);
    if (!creditCheck.allowed) {
      console.log(`[create-post] Insufficient credits for business ${businessId}: balance=${creditCheck.balance}`);
      return NextResponse.redirect(`${appUrl}/scout/confirm?status=insufficient_credits&balance=${creditCheck.balance}`);
    }

    // Load story + business
    const story = await prisma.scoutStory.findUnique({ where: { id: storyId } });
    if (!story) {
      console.error(`[create-post] Story ${storyId} not found`);
      return NextResponse.redirect(`${appUrl}/scout/expired?reason=invalid`);
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, websiteUrl: true, businessName: true },
    });
    if (!business) {
      console.error(`[create-post] Business ${businessId} not found`);
      return NextResponse.redirect(`${appUrl}/scout/expired?reason=invalid`);
    }

    // Create PostPackage record
    const postPackage = await prisma.postPackage.create({
      data: {
        userId,
        businessId,
        storyId: story.id,
        scoutReportId: scoutReportId || undefined,
        source: 'daily_scout_email',
        status: 'generating',
        storyTitle: story.title,
        storySource: story.source,
        storyUrl: story.sourceUrl,
        storySummary: story.summary,
        suggestedAngle: story.suggestedAngle,
      },
    });

    console.log(`[create-post] Created PostPackage ${postPackage.id} for story "${story.title.slice(0, 50)}"`);

    // Launch Tombstone workflow
    const missionResult = await createScoutStoryMission(
      business.websiteUrl,
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
        businessId,
        userId,
        scoutReportId: scoutReportId || '',
        storyId: story.id,
        postPackageId: postPackage.id,
      },
    );

    if (!missionResult.success || !missionResult.workflowId) {
      console.error('[create-post] Tombstone mission creation failed');
      await prisma.postPackage.update({
        where: { id: postPackage.id },
        data: { status: 'rejected' },
      });
      return NextResponse.redirect(`${appUrl}/scout/confirm?status=error`);
    }

    // Update PostPackage with workflow ID
    await prisma.postPackage.update({
      where: { id: postPackage.id },
      data: { workflowId: missionResult.workflowId },
    });

    console.log(`[create-post] Workflow ${missionResult.workflowId} created for PostPackage ${postPackage.id}`);
    return NextResponse.redirect(`${appUrl}/scout/confirm?status=success&packageId=${postPackage.id}`);
  } catch (err: any) {
    console.error('[create-post] Error:', err);
    return NextResponse.redirect(`${appUrl}/scout/confirm?status=error`);
  }
}
