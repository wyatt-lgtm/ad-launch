export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createDraftPolishMission } from '@/lib/tombstone';
import { fetchAndParseArticle, buildCarouselPackage, buildCarouselFromDraft } from '@/lib/article-carousel';
import { generateCarouselImages } from '@/lib/carousel-image-gen';
import type { CarouselPackage } from '@/lib/article-carousel';

/**
 * POST /api/social/create-from-draft
 *
 * Three modes:
 * 1. articleUrl provided → fetch article → carousel pipeline → SocialPost
 * 2. draftText + forceCarousel → LLM carousel detection from user text → SocialPost
 * 3. draftText only → Tombstone draft-polish pipeline (existing behavior)
 *
 * Body: {
 *   draftText?: string
 *   articleUrl?: string
 *   forceCarousel?: boolean  (auto-detect list content in draft)
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
      articleUrl,
      forceCarousel = false,
      platform,
      tone,
      cta,
      offer,
      artDirection,
      generateArt = true,
      businessId,
    } = body;

    // Must have either draftText or articleUrl
    const hasDraft = draftText && typeof draftText === 'string' && draftText.trim().length > 0;
    const hasArticle = articleUrl && typeof articleUrl === 'string' && articleUrl.trim().length > 0;

    if (!hasDraft && !hasArticle) {
      return NextResponse.json(
        { error: 'Either draft text or an article URL is required' },
        { status: 400 }
      );
    }

    // Resolve business
    let websiteUrl: string | null = null;
    let resolvedBusinessId = businessId || null;
    let businessName = 'Business';
    let tombstoneBusinessId: number | null = null;

    if (businessId) {
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
        select: { websiteUrl: true, userId: true, businessName: true, tombstoneBusinessId: true },
      });
      if (biz && biz.userId === userId) {
        websiteUrl = biz.websiteUrl;
        businessName = biz.businessName || 'Business';
        tombstoneBusinessId = biz.tombstoneBusinessId;
      }
    }

    if (!websiteUrl) {
      const biz2 = await prisma.business.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, websiteUrl: true, businessName: true, tombstoneBusinessId: true },
      });
      if (biz2) {
        websiteUrl = biz2.websiteUrl;
        businessName = biz2.businessName || 'Business';
        if (!resolvedBusinessId) resolvedBusinessId = biz2.id;
        if (!tombstoneBusinessId) tombstoneBusinessId = biz2.tombstoneBusinessId;
      }
    }

    if (!websiteUrl) {
      return NextResponse.json(
        { error: 'No business website URL found. Complete a business analysis first.' },
        { status: 400 }
      );
    }

    // ─── PATH 1: Article URL → Carousel Pipeline ─────────────────────
    if (hasArticle) {
      console.log(`[create-from-draft] Article URL mode: ${articleUrl} for business=${resolvedBusinessId}`);

      // Fetch and parse article
      let article;
      try {
        article = await fetchAndParseArticle(articleUrl.trim());
      } catch (err: any) {
        console.error(`[create-from-draft] Article fetch failed: ${err.message}`);
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

      // Build carousel package via LLM — use draftText as additional context if provided
      let carouselPkg: CarouselPackage;
      try {
        // If user also provided draft text, prepend it as context/angle
        if (hasDraft) {
          article.bodyText = `USER CONTEXT/ANGLE:\n${draftText.trim()}\n\n---\n\nARTICLE CONTENT:\n${article.bodyText}`;
        }
        carouselPkg = await buildCarouselPackage(article, {
          businessName,
          websiteUrl: websiteUrl || undefined,
        });
      } catch (err: any) {
        console.error(`[create-from-draft] Carousel build failed: ${err.message}`);
        return NextResponse.json(
          { error: 'Failed to analyze article for post creation.', detail: err.message },
          { status: 500 },
        );
      }

      // Generate slide images if carousel
      let slideImageUrls: string[] = [];
      let renderedSlides: any[] = carouselPkg.slides.map(s => ({
        slide_number: s.slide_number,
        headline: s.headline,
        bullets: s.bullets,
        imageUrl: null,
      }));

      if (carouselPkg.post_type === 'carousel' && generateArt) {
        console.log(`[create-from-draft] Generating ${carouselPkg.slides.length} slide images...`);
        const imageResults = await generateCarouselImages(carouselPkg.slides, {
          businessName,
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
      }

      // Create the SocialPost directly (no Tombstone needed for article posts)
      const isCarousel = carouselPkg.post_type === 'carousel' && renderedSlides.length > 0;
      const hashtagMatches = carouselPkg.caption.match(/#\w+/g) || [];
      const captionClean = carouselPkg.caption.replace(/#\w+\s*/g, '').trim();

      const socialPost = await prisma.socialPost.create({
        data: {
          userId,
          businessId: resolvedBusinessId,
          caption: captionClean,
          hashtags: hashtagMatches.map(h => h.replace('#', '')),
          imageUrl: slideImageUrls[0] || null,
          postType: isCarousel ? 'carousel' : 'general',
          status: 'pending_approval',
          platforms: ['facebook', 'instagram'],
          sourceArticleTitle: carouselPkg.article_title,
          sourceArticleUrl: carouselPkg.source_url,
          sourceName: carouselPkg.source_publisher,
          sourceType: 'article_carousel',
          cta: carouselPkg.platform_notes?.facebook || cta || '',
          carouselData: isCarousel ? (carouselPkg as any) : null,
          carouselSlides: isCarousel ? (renderedSlides as any) : null,
          carouselImageUrls: slideImageUrls,
          sourceAttribution: carouselPkg.source_attribution,
        },
      });

      console.log(`[create-from-draft] Article post created: ${socialPost.id} (type=${isCarousel ? 'carousel' : 'standard'}, slides=${renderedSlides.length})`);

      return NextResponse.json({
        success: true,
        postId: socialPost.id,
        postType: isCarousel ? 'carousel' : 'standard',
        carouselPackage: isCarousel ? carouselPkg : null,
        slideImages: isCarousel ? renderedSlides : null,
        intent: 'article_to_post',
        source: 'article_url',
        immediate: true, // No Tombstone polling needed
      });
    }

    // ─── PATH 2: Draft Text + Carousel Detection ─────────────────────
    if (hasDraft && forceCarousel) {
      console.log(`[create-from-draft] Carousel detection mode for draft (${draftText.length} chars) business=${resolvedBusinessId}`);

      let carouselPkg: CarouselPackage;
      try {
        carouselPkg = await buildCarouselFromDraft(draftText.trim(), {
          businessName,
          websiteUrl: websiteUrl || undefined,
        });
      } catch (err: any) {
        console.error(`[create-from-draft] Draft carousel build failed: ${err.message}`);
        return NextResponse.json(
          { error: 'Failed to analyze draft for carousel creation.', detail: err.message },
          { status: 500 },
        );
      }

      // If LLM says it's not carousel-worthy, fall through to Tombstone path
      if (carouselPkg.post_type !== 'carousel') {
        console.log(`[create-from-draft] Draft not carousel-worthy (${carouselPkg.fallback_reason}), falling through to Tombstone polish`);
        // Fall through to PATH 3 below
      } else {
        // Generate slide images
        let slideImageUrls: string[] = [];
        let renderedSlides: any[] = carouselPkg.slides.map(s => ({
          slide_number: s.slide_number,
          headline: s.headline,
          bullets: s.bullets,
          imageUrl: null,
        }));

        if (generateArt) {
          console.log(`[create-from-draft] Generating ${carouselPkg.slides.length} slide images for draft carousel...`);
          const imageResults = await generateCarouselImages(carouselPkg.slides, {
            businessName,
            sourcePublisher: businessName,
            articleTitle: 'User Post',
          });
          slideImageUrls = imageResults.map(r => r.imageUrl).filter(Boolean) as string[];
          renderedSlides = carouselPkg.slides.map((s, i) => ({
            slide_number: s.slide_number,
            headline: s.headline,
            bullets: s.bullets,
            imageUrl: imageResults[i]?.imageUrl || null,
          }));
        }

        const hashtagMatches = carouselPkg.caption.match(/#\w+/g) || [];
        const captionClean = carouselPkg.caption.replace(/#\w+\s*/g, '').trim();

        const socialPost = await prisma.socialPost.create({
          data: {
            userId,
            businessId: resolvedBusinessId,
            caption: captionClean,
            hashtags: hashtagMatches.map(h => h.replace('#', '')),
            imageUrl: slideImageUrls[0] || null,
            postType: 'carousel',
            status: 'pending_approval',
            platforms: ['facebook', 'instagram'],
            sourceType: 'user_draft_carousel',
            cta: cta || carouselPkg.platform_notes?.facebook || '',
            carouselData: carouselPkg as any,
            carouselSlides: renderedSlides as any,
            carouselImageUrls: slideImageUrls,
            sourceAttribution: `Posted by ${businessName}`,
          },
        });

        console.log(`[create-from-draft] Draft carousel post created: ${socialPost.id} (slides=${renderedSlides.length})`);

        return NextResponse.json({
          success: true,
          postId: socialPost.id,
          postType: 'carousel',
          carouselPackage: carouselPkg,
          slideImages: renderedSlides,
          intent: 'user_draft_carousel',
          source: 'user_written_post',
          immediate: true,
        });
      }
    }

    // ─── PATH 3: Standard Draft → Tombstone Polish ───────────────────
    console.log(`[create-from-draft] Tombstone polish mode: userId=${userId} business=${resolvedBusinessId} art=${generateArt}`);

    const result = await createDraftPolishMission(websiteUrl, draftText.trim(), {
      platform: platform || undefined,
      tone: tone || undefined,
      cta: cta || undefined,
      offer: offer || undefined,
      artDirection: artDirection || undefined,
      generateArt,
      tombstoneBusinessId,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to start creative workflow in Tombstone' },
        { status: 502 }
      );
    }

    const socialMissionId = result.workflowIds.join(',');

    // Store mission ID on the correct business's analysis for polling
    let targetAnalysis = resolvedBusinessId
      ? await prisma.analysis.findFirst({
          where: { userId, businessId: resolvedBusinessId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, socialMissionId: true },
        })
      : null;

    // If no Analysis for this business, create a stub so missions/poll
    // can discover the workflow via the normal workflow-based lane.
    if (!targetAnalysis && resolvedBusinessId) {
      const created = await prisma.analysis.create({
        data: {
          userId,
          businessId: resolvedBusinessId,
          websiteUrl: websiteUrl || '',
          socialMissionId: socialMissionId,
          status: 'completed',
        },
        select: { id: true, socialMissionId: true },
      });
      targetAnalysis = created;
      console.log(`[create-from-draft] Created stub Analysis ${created.id} for business=${resolvedBusinessId} to store socialMissionId`);
    } else if (!targetAnalysis) {
      // No business and no analysis — best-effort fallback to most recent analysis
      targetAnalysis = await prisma.analysis.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, socialMissionId: true },
      });
    }

    if (targetAnalysis) {
      // Only update if the socialMissionId isn't already set (stub creation sets it above)
      if (!targetAnalysis.socialMissionId?.includes(socialMissionId)) {
        const existing = targetAnalysis.socialMissionId || '';
        const updated = existing ? `${existing},${socialMissionId}` : socialMissionId;
        await prisma.analysis.update({
          where: { id: targetAnalysis.id },
          data: { socialMissionId: updated },
        });
      }
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