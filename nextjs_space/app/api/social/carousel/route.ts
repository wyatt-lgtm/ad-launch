export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { fetchAndParseArticle, buildCarouselPackage } from '@/lib/article-carousel';
import { generateCarouselImages } from '@/lib/carousel-image-gen';
import type { CarouselPackage } from '@/lib/article-carousel';

/**
 * POST /api/social/carousel
 *
 * Creates a carousel social post from an article URL.
 *
 * Body: {
 *   articleUrl: string       (required)
 *   businessId: string       (required)
 *   skipImageGeneration?: boolean  (optional, for preview/dry-run)
 * }
 *
 * Flow:
 * 1. Fetch & parse article
 * 2. LLM detects article type + builds carousel package
 * 3. Generate slide images (unless skipImageGeneration)
 * 4. Create SocialPost record in DB
 * 5. Return full carousel package + post ID
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();
    const { articleUrl, businessId, skipImageGeneration } = body;

    if (!articleUrl || typeof articleUrl !== 'string') {
      return NextResponse.json({ error: 'articleUrl is required' }, { status: 400 });
    }
    if (!businessId || typeof businessId !== 'string') {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    // Validate business belongs to user
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: user.id },
      select: {
        id: true,
        businessName: true,
        websiteUrl: true,
      },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    console.log(`[carousel] Starting for business "${business.businessName}" article: ${articleUrl}`);

    // Step 1: Fetch and parse the article
    let article;
    try {
      article = await fetchAndParseArticle(articleUrl);
    } catch (err: any) {
      console.error(`[carousel] Article fetch failed: ${err.message}`);
      return NextResponse.json(
        { error: 'Could not fetch or parse the article. Please check the URL and try again.', detail: err.message },
        { status: 422 },
      );
    }

    if (!article.title && !article.bodyText) {
      return NextResponse.json(
        { error: 'Could not extract meaningful content from this article.' },
        { status: 422 },
      );
    }

    console.log(`[carousel] Parsed: "${article.title.slice(0, 60)}" | ${article.headings.length} headings, ${article.listItems.length} list items`);

    // Step 2: Build carousel package via LLM
    let carouselPkg: CarouselPackage;
    try {
      carouselPkg = await buildCarouselPackage(article, {
        businessName: business.businessName || 'Business',
        websiteUrl: business.websiteUrl || undefined,
      });
    } catch (err: any) {
      console.error(`[carousel] LLM carousel build failed: ${err.message}`);
      return NextResponse.json(
        { error: 'Failed to analyze article for carousel creation.', detail: err.message },
        { status: 500 },
      );
    }

    console.log(`[carousel] Package built: type=${carouselPkg.post_type}, article_type=${carouselPkg.detected_article_type}, slides=${carouselPkg.slides.length}, key_points=${carouselPkg.key_points.length}`);

    // Step 3: Generate slide images (unless skipped)
    let slideImageUrls: string[] = [];
    let renderedSlides: any[] = carouselPkg.slides.map(s => ({
      slide_number: s.slide_number,
      headline: s.headline,
      bullets: s.bullets,
      imageUrl: null,
    }));

    if (carouselPkg.post_type === 'carousel' && !skipImageGeneration) {
      console.log(`[carousel] Generating ${carouselPkg.slides.length} slide images...`);

      const imageResults = await generateCarouselImages(carouselPkg.slides, {
        businessName: business.businessName || 'Business',
        sourcePublisher: carouselPkg.source_publisher,
        articleTitle: carouselPkg.article_title,
      });

      slideImageUrls = imageResults.map(r => r.imageUrl).filter(Boolean) as string[];
      renderedSlides = carouselPkg.slides.map((s, i) => ({
        slide_number: s.slide_number,
        headline: s.headline,
        bullets: s.bullets,
        imageUrl: imageResults[i]?.imageUrl || null,
      }));

      console.log(`[carousel] Images generated: ${slideImageUrls.length}/${carouselPkg.slides.length} successful`);
    }

    // Step 4: Determine post type and create the social post
    const isCarousel = carouselPkg.post_type === 'carousel' && renderedSlides.length > 0;
    const postType = isCarousel ? 'carousel' : 'general';
    const firstImageUrl = slideImageUrls[0] || null;

    // Extract hashtags from caption if present
    const hashtagMatches = carouselPkg.caption.match(/#\w+/g) || [];
    const captionWithoutHashtags = carouselPkg.caption.replace(/#\w+\s*/g, '').trim();

    const socialPost = await prisma.socialPost.create({
      data: {
        userId: user.id,
        businessId: business.id,
        caption: captionWithoutHashtags,
        hashtags: hashtagMatches.map(h => h.replace('#', '')),
        imageUrl: firstImageUrl,
        postType,
        status: 'pending_approval',
        platforms: ['facebook', 'instagram'],
        sourceArticleTitle: carouselPkg.article_title,
        sourceArticleUrl: carouselPkg.source_url,
        sourceName: carouselPkg.source_publisher,
        sourceType: 'article_carousel',
        cta: carouselPkg.platform_notes?.facebook || '',
        carouselData: carouselPkg as any,
        carouselSlides: renderedSlides,
        carouselImageUrls: slideImageUrls,
        sourceAttribution: carouselPkg.source_attribution,
      },
    });

    console.log(`[carousel] Post created: ${socialPost.id} (type=${postType}, slides=${renderedSlides.length})`);

    return NextResponse.json({
      success: true,
      postId: socialPost.id,
      postType,
      carouselPackage: carouselPkg,
      slideImages: renderedSlides,
      slideImageUrls,
      fallbackReason: carouselPkg.fallback_reason || null,
    });
  } catch (err: any) {
    console.error('[carousel] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: err.message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/social/carousel?postId=xxx
 *
 * Retrieve carousel data for an existing post.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const postId = req.nextUrl.searchParams.get('postId');
    if (!postId) {
      return NextResponse.json({ error: 'postId query param required' }, { status: 400 });
    }

    const post = await prisma.socialPost.findFirst({
      where: { id: postId, userId: user.id },
      select: {
        id: true,
        postType: true,
        caption: true,
        hashtags: true,
        imageUrl: true,
        carouselData: true,
        carouselSlides: true,
        carouselImageUrls: true,
        sourceAttribution: true,
        sourceArticleTitle: true,
        sourceArticleUrl: true,
        sourceName: true,
        status: true,
        createdAt: true,
      },
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    return NextResponse.json(post);
  } catch (err: any) {
    console.error('[carousel] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
