export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createWeeklyTipMission } from '@/lib/tombstone';
import { checkCredits } from '@/lib/credits';
import { getOrEnrichContentProfile } from '@/lib/content-profile';

/**
 * POST /api/social/create-weekly-tip
 *
 * Creates a weekly tip post via Tombstone.
 *
 * Body: {
 *   businessId: string (required)
 *   topic: string (required)
 *   category: string (required)
 *   audience?: string
 *   tone?: string
 *   cta?: string
 *   customTopic?: string (overrides topic if set)
 *   generateArt?: boolean (default true)
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
      businessId,
      topic,
      category,
      audience = 'All customers',
      tone = 'Friendly & conversational',
      cta,
      customTopic,
      generateArt = true,
    } = body;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }
    if (!topic && !customTopic) {
      return NextResponse.json({ error: 'A topic or customTopic is required' }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: 'category is required' }, { status: 400 });
    }

    // Verify ownership
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true, websiteUrl: true, businessName: true, businessCity: true, businessState: true },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Check credits (1 credit for image post)
    const creditCheck = await checkCredits(businessId, 1);
    if (!creditCheck.allowed) {
      return NextResponse.json(
        { error: 'Not enough credits to create a post.', balance: creditCheck.balance },
        { status: 402 },
      );
    }

    // Get content profile for context
    const profile = await getOrEnrichContentProfile(businessId);

    const effectiveTopic = customTopic?.trim() || topic;

    console.log(`[create-weekly-tip] userId=${userId} business=${businessId} topic="${effectiveTopic}" category="${category}"`);

    const result = await createWeeklyTipMission(
      business.websiteUrl,
      {
        topic: effectiveTopic,
        category,
        audience,
        tone,
        cta: cta || undefined,
        generateArt,
        businessName: business.businessName || undefined,
        location: [business.businessCity, business.businessState].filter(Boolean).join(', ') || undefined,
        contentPillars: profile?.contentPillars || [],
        allowedAdjacentTopics: profile?.allowedAdjacentTopics || [],
        restrictedTopics: profile?.restrictedTopics || [],
        brandVoiceSummary: profile?.brandVoiceSummary || '',
        industry: profile?.industry || '',
      },
    );

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to start creative workflow' },
        { status: 502 },
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
      const existing = recentAnalysis.socialMissionId || '';
      const updated = existing ? `${existing},${socialMissionId}` : socialMissionId;
      await prisma.analysis.update({
        where: { id: recentAnalysis.id },
        data: { socialMissionId: updated },
      });
    }

    console.log(`[create-weekly-tip] Mission created: ${socialMissionId} (${result.allTaskIds.length} tasks)`);

    return NextResponse.json({
      success: true,
      socialMissionId,
      workflowIds: result.workflowIds,
      taskCount: result.allTaskIds.length,
      source: 'weekly_tip',
      workflow_type: 'evergreen_weekly_tip',
    });
  } catch (error: any) {
    console.error('[create-weekly-tip] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
