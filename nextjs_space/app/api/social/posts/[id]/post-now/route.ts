export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { buildLandingPageBlock } from '@/lib/social-landing-page';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/social/posts/[id]/post-now
 * Marks a social post as published ("posted now").
 * Body: { platforms?: string[] }
 *
 * Eligibility:
 *  - Post must have caption
 *  - Post must have image (or be carousel with images)
 *  - Post must not already be published/publishing
 *  - Post must belong to the authenticated user
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

    // Duplicate prevention: already published/publishing
    if (post.status === 'published' || post.status === 'manually_posted') {
      return NextResponse.json(
        { error: 'already_posted', message: 'This post has already been published.' },
        { status: 409 }
      );
    }

    // Eligibility: must have caption
    if (!post.caption?.trim()) {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post is incomplete — caption is missing. Edit or regenerate before publishing.' },
        { status: 422 }
      );
    }

    // Eligibility: must have image (unless carousel with images)
    const carouselUrls = (post as any).carouselImageUrls as string[] | null;
    const hasImage = !!post.imageUrl || (Array.isArray(carouselUrls) && carouselUrls.length > 0);
    if (!hasImage) {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post is incomplete — image is missing. Edit or regenerate before publishing.' },
        { status: 422 }
      );
    }

    // Eligibility: reject failed/incomplete statuses
    if (post.status === 'generation_failed' || post.status === 'generation_incomplete') {
      return NextResponse.json(
        { error: 'incomplete_post', message: 'Post generation failed or is incomplete. Fix or regenerate before publishing.' },
        { status: 422 }
      );
    }

    // Parse optional platforms from body
    const body = await req.json().catch(() => ({}));
    const platforms = Array.isArray(body.platforms) ? body.platforms : post.platforms;
    const includeLandingPage = body.includeLandingPage === true;

    // Build warnings
    const warnings: string[] = [];
    if (!(post as any).sourceArticleUrl && !(post as any).rssItemLink) {
      warnings.push('Source article link missing.');
    }

    // Optionally append landing page CTA to caption
    let finalCaption = post.caption || '';
    if (includeLandingPage && (post as any).businessId) {
      const biz = await prisma.business.findUnique({
        where: { id: (post as any).businessId },
        select: { defaultSocialLandingPageUrl: true, defaultSocialLandingPageEnabled: true, defaultSocialCtaText: true },
      });
      if (biz?.defaultSocialLandingPageEnabled && biz.defaultSocialLandingPageUrl) {
        const block = buildLandingPageBlock(finalCaption, {
          url: biz.defaultSocialLandingPageUrl,
          ctaText: biz.defaultSocialCtaText || 'Learn more here:',
          enabled: true,
        }, {
          platform: platforms[0] || 'social',
          campaign: (post as any).patternType || 'social',
          contentId: post.id,
        });
        if (block) finalCaption += block;
      }
    }

    // Mark as published
    const updated = await prisma.socialPost.update({
      where: { id },
      data: {
        status: 'manually_posted',
        publishedAt: new Date(),
        platforms,
        ...(finalCaption !== post.caption ? { caption: finalCaption } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      post: {
        id: updated.id,
        status: updated.status,
        publishedAt: updated.publishedAt,
        platforms: updated.platforms,
      },
      warnings,
    });
  } catch (error: any) {
    console.error('[post-now] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
