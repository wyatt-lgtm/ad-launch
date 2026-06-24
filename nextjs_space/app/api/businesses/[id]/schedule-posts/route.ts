export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import {
  buildScheduledPostsData,
  type ApprovalMode,
  type Cadence,
} from '@/lib/scheduling-utils';

/**
 * POST /api/businesses/[id]/schedule-posts
 * Takes generated social posts and creates a scheduled post queue.
 * Body: { postIds: string[], cadence, approvalMode, platforms, timezone }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      postIds = [],
      cadence = 'standard',
      approvalMode = 'auto_after_approval',
      platforms = ['facebook', 'google_business'],
      timezone = 'America/Denver',
    } = body;

    if (!Array.isArray(postIds) || postIds.length === 0) {
      return NextResponse.json({ error: 'At least one post ID is required' }, { status: 400 });
    }

    // Fetch the source social posts
    const socialPosts = await prisma.socialPost.findMany({
      where: {
        id: { in: postIds },
        businessId,
      },
    });

    if (socialPosts.length === 0) {
      return NextResponse.json({ error: 'No valid posts found for this business' }, { status: 404 });
    }

    const postInputs = socialPosts.map((sp: any) => ({
      socialPostId: sp.id,
      caption: sp.caption,
      imageUrl: sp.imageUrl ?? undefined,
      hashtags: sp.hashtags,
      cta: sp.cta ?? undefined,
      platforms,
      lane: sp.sourceType === 'user_draft' ? undefined : (sp as any).lane ?? undefined,
      sourceType: sp.sourceType ?? 'generation',
    }));

    const scheduledData = buildScheduledPostsData(
      postInputs,
      cadence as Cadence,
      timezone,
      approvalMode as ApprovalMode,
      platforms
    );

    // Create all scheduled posts in a transaction
    const created = await prisma.$transaction(
      scheduledData.map(item =>
        prisma.scheduledPost.create({
          data: {
            businessId,
            userId,
            socialPostId: item.input.socialPostId ?? null,
            caption: item.input.caption,
            imageUrl: item.input.imageUrl ?? null,
            hashtags: item.input.hashtags ?? [],
            cta: item.input.cta ?? null,
            platforms: item.input.platforms,
            scheduledFor: item.scheduledFor,
            timezone,
            status: item.status,
            approvalRequired: item.approvalRequired,
            lane: item.input.lane ?? null,
            sourceType: item.input.sourceType ?? null,
          },
        })
      )
    );

    return NextResponse.json({
      scheduled: created,
      count: created.length,
    });
  } catch (err: any) {
    console.error('[schedule-posts POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
