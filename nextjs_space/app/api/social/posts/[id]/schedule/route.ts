export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { buildLandingPageBlock } from '@/lib/social-landing-page';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/social/posts/[id]/schedule
 * Creates a ScheduledPost from a SocialPost.
 * Body: { scheduledFor: ISO string, timezone?: string, platforms?: string[] }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const { id } = await context.params;

    const post = await prisma.socialPost.findFirst({
      where: { id, userId },
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    // Duplicate prevention: already scheduled or published
    if (post.status === 'published' || post.status === 'manually_posted') {
      return NextResponse.json(
        { error: 'already_posted', message: 'This post has already been published.' },
        { status: 409 }
      );
    }

    // Eligibility: must have caption
    if (!post.caption?.trim()) {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post is incomplete — caption is missing.' },
        { status: 422 }
      );
    }

    // Eligibility: must have image
    const carouselUrls = (post as any).carouselImageUrls as string[] | null;
    const hasImage = !!post.imageUrl || (Array.isArray(carouselUrls) && carouselUrls.length > 0);
    if (!hasImage) {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post is incomplete — image is missing.' },
        { status: 422 }
      );
    }

    // Eligibility: reject failed/incomplete
    if (post.status === 'generation_failed' || post.status === 'generation_incomplete') {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post generation failed or is incomplete.' },
        { status: 422 }
      );
    }

    // Parse body
    const body = await req.json().catch(() => ({}));
    const { scheduledFor, timezone, platforms } = body;

    if (!scheduledFor) {
      return NextResponse.json(
        { error: 'missing_scheduled_time', message: 'scheduledFor (ISO date) is required.' },
        { status: 400 }
      );
    }

    const scheduledDate = new Date(scheduledFor);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json(
        { error: 'invalid_date', message: 'scheduledFor must be a valid ISO date string.' },
        { status: 400 }
      );
    }

    if (scheduledDate.getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'past_date', message: 'Cannot schedule a post in the past.' },
        { status: 400 }
      );
    }

    const businessId = (post as any).businessId;
    if (!businessId) {
      return NextResponse.json(
        { error: 'no_business', message: 'This post is not associated with a business.' },
        { status: 422 }
      );
    }

    const resolvedPlatforms = Array.isArray(platforms) ? platforms : post.platforms;
    const resolvedTimezone = timezone || 'America/Denver';
    const includeLandingPage = body.includeLandingPage === true;

    // Optionally append landing page CTA to caption
    let finalCaption = post.caption || '';
    if (includeLandingPage && businessId) {
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
        select: { defaultSocialLandingPageUrl: true, defaultSocialLandingPageEnabled: true, defaultSocialCtaText: true },
      });
      if (biz?.defaultSocialLandingPageEnabled && biz.defaultSocialLandingPageUrl) {
        const block = buildLandingPageBlock(finalCaption, {
          url: biz.defaultSocialLandingPageUrl,
          ctaText: biz.defaultSocialCtaText || 'Learn more here:',
          enabled: true,
        }, {
          platform: resolvedPlatforms[0] || 'social',
          campaign: (post as any).patternType || 'social',
          contentId: post.id,
        });
        if (block) finalCaption += block;
      }
    }

    // Check for duplicate scheduled post for same socialPost
    const existingScheduled = await prisma.scheduledPost.findFirst({
      where: {
        socialPostId: id,
        status: { in: ['needs_approval', 'approved', 'scheduled'] },
      },
    });

    if (existingScheduled) {
      return NextResponse.json(
        { error: 'already_scheduled', message: 'This post is already scheduled. Remove the existing schedule first.' },
        { status: 409 }
      );
    }

    // Create the ScheduledPost
    const scheduled = await prisma.scheduledPost.create({
      data: {
        businessId,
        userId,
        socialPostId: id,
        caption: finalCaption,
        imageUrl: post.imageUrl ?? null,
        hashtags: post.hashtags ?? [],
        cta: (post as any).cta ?? null,
        platforms: resolvedPlatforms,
        scheduledFor: scheduledDate,
        timezone: resolvedTimezone,
        status: 'scheduled',
        approvalRequired: false,
      },
    });

    // Update social post status to reflect scheduling
    await prisma.socialPost.update({
      where: { id },
      data: {
        status: 'approved',
        scheduledFor: scheduledDate,
      },
    });

    return NextResponse.json({
      success: true,
      scheduledPost: {
        id: scheduled.id,
        scheduledFor: scheduled.scheduledFor,
        timezone: scheduled.timezone,
        platforms: scheduled.platforms,
        status: scheduled.status,
      },
    });
  } catch (error: any) {
    console.error('[schedule-post] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
