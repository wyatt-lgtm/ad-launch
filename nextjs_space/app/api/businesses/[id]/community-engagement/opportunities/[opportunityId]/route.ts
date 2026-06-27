// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/businesses/[id]/community-engagement/opportunities/[opportunityId]
 * Handles: review, draft generation, create-content-task actions
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; opportunityId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const { id: businessId, opportunityId } = params;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const opp = await prisma.communityEngagementOpportunity.findFirst({
      where: { id: opportunityId, businessId },
    });
    if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'review': {
        const { decision, notes } = body;
        const validDecisions = ['approved', 'rewrite', 'not_relevant', 'create_content', 'archived'];
        if (!validDecisions.includes(decision)) {
          return NextResponse.json({ error: `Invalid decision. Must be: ${validDecisions.join(', ')}` }, { status: 400 });
        }

        const statusMap: Record<string, string> = {
          approved: 'approved',
          rewrite: 'draft_ready',
          not_relevant: 'archived',
          create_content: 'content_needed',
          archived: 'archived',
        };

        const updated = await prisma.communityEngagementOpportunity.update({
          where: { id: opportunityId },
          data: {
            reviewerUserId: userId,
            reviewDecision: decision,
            reviewNotes: notes || null,
            reviewedAt: new Date(),
            status: statusMap[decision] || opp.status,
            draftStatus: decision === 'approved' ? 'approved' : decision === 'rewrite' ? 'rewrite_requested' : decision === 'not_relevant' ? 'rejected' : opp.draftStatus,
          },
        });

        console.log(`[community-engagement] Review: opp=${opportunityId} decision=${decision} by user=${userId}`);
        return NextResponse.json({ opportunity: updated });
      }

      case 'update_outcome': {
        const { manuallyPostedUrl, referralClicks, conversions, outcomeNotes } = body;
        const updated = await prisma.communityEngagementOpportunity.update({
          where: { id: opportunityId },
          data: {
            manuallyPostedUrl: manuallyPostedUrl || opp.manuallyPostedUrl,
            postedAt: manuallyPostedUrl ? new Date() : opp.postedAt,
            referralClicks: referralClicks ?? opp.referralClicks,
            conversions: conversions ?? opp.conversions,
            outcomeNotes: outcomeNotes || opp.outcomeNotes,
          },
        });
        return NextResponse.json({ opportunity: updated });
      }

      case 'create_content_task': {
        // Generate a content creation task suggestion
        const contentTask = {
          suggestedTitle: `Answer: ${opp.threadTitle}`,
          targetQuestion: opp.threadTitle,
          threadUrl: opp.threadUrl,
          topic: opp.topic,
          recommendedFormat: 'explainer_article',
          suggestedVideoFormat: 'walkthrough',
          suggestedFaqSection: `Q: ${opp.threadTitle}`,
          suggestedInternalLinks: [],
          suggestedSchema: 'FAQPage',
          createdAt: new Date().toISOString(),
        };

        // Update the opportunity status
        await prisma.communityEngagementOpportunity.update({
          where: { id: opportunityId },
          data: {
            status: 'content_needed',
            reviewDecision: 'create_content',
            reviewerUserId: userId,
            reviewedAt: new Date(),
            reviewNotes: body.notes || 'Content creation recommended instead of posting',
          },
        });

        console.log(`[community-engagement] Content task created for opp=${opportunityId}`);
        return NextResponse.json({ contentTask });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[community-engagement/opportunity] POST error:', err);
    return NextResponse.json({ error: 'Failed to process action' }, { status: 500 });
  }
}

/**
 * GET /api/businesses/[id]/community-engagement/opportunities/[opportunityId]
 * Returns single opportunity with full details.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; opportunityId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const { id: businessId, opportunityId } = params;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const opp = await prisma.communityEngagementOpportunity.findFirst({
      where: { id: opportunityId, businessId },
      include: { contentMatches: true, reviewer: { select: { email: true } } },
    });
    if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });

    return NextResponse.json({ opportunity: opp });
  } catch (err: any) {
    console.error('[community-engagement/opportunity] GET error:', err);
    return NextResponse.json({ error: 'Failed to load opportunity' }, { status: 500 });
  }
}
