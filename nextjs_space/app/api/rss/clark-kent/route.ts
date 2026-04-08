export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';
import type { ContentBrief } from '@/lib/rss/trade-area-feed';

/**
 * Clark Kent — Local News Scout
 *
 * POST /api/rss/clark-kent
 * Body: { analysisId?, zip?, radius?, platforms?, postCount? }
 *
 * Pipeline:
 *   1. Resolve business ZIP from analysisId or direct zip param
 *   2. Call generateContentBrief() to get ranked local items
 *   3. LLM picks best items + writes platform-tailored social copy
 *   4. Creates SocialPost records in "pending_approval" status
 *   5. Returns the created posts
 */
export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await req.json();
    const {
      analysisId,
      zip: directZip,
      radius = 25,
      platforms = ['facebook', 'instagram'],
      postCount = 3,
    } = body;

    // ── Step 1: Resolve business ZIP ─────────────────────────────────────
    let businessZip: string | null = directZip || null;
    let businessName: string | null = null;
    let websiteUrl: string | null = null;
    let resolvedAnalysisId: string | null = analysisId || null;

    if (analysisId) {
      const analysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        select: { businessZip: true, businessName: true, websiteUrl: true },
      });
      if (analysis) {
        businessZip = analysis.businessZip || businessZip;
        businessName = analysis.businessName;
        websiteUrl = analysis.websiteUrl;
      }
    }

    if (!businessZip) {
      // Try to find the most recent analysis for this user with a confirmed ZIP
      const recentAnalysis = await prisma.analysis.findFirst({
        where: { userId, businessZip: { not: null }, geoConfirmed: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, businessZip: true, businessName: true, websiteUrl: true },
      });
      if (recentAnalysis) {
        businessZip = recentAnalysis.businessZip;
        businessName = recentAnalysis.businessName;
        websiteUrl = recentAnalysis.websiteUrl;
        resolvedAnalysisId = resolvedAnalysisId || recentAnalysis.id;
      }
    }

    if (!businessZip) {
      return NextResponse.json(
        { error: 'No business ZIP available. Please complete a business analysis first or provide a ZIP code.' },
        { status: 400 }
      );
    }

    // ── Step 2: Get content brief ────────────────────────────────────────
    const brief = await generateContentBrief(businessZip, radius, {
      days: 5,
      limit: 30,
    });

    if (brief.summary.totalItems === 0) {
      return NextResponse.json({
        posts: [],
        message: 'No fresh local content found in your trade area. Check back soon!',
        brief: { totalItems: 0, feedsMatched: 0 },
      });
    }

    // ── Step 3: LLM picks best items + writes copy ───────────────────────
    const llmPosts = await generateSocialPosts(brief, {
      businessName,
      websiteUrl,
      platforms,
      postCount: Math.min(postCount, 5), // Cap at 5
    });

    // ── Step 4: Save to database ─────────────────────────────────────────
    const createdPosts = [];
    for (const post of llmPosts) {
      // Find the matching RSS item from the brief
      const matchedHeadline = brief.headlines.find(h => h.id === post.rssItemId);

      const created = await prisma.socialPost.create({
        data: {
          userId,
          analysisId: resolvedAnalysisId,
          caption: post.caption,
          hashtags: post.hashtags,
          rssItemId: post.rssItemId || null,
          rssItemTitle: matchedHeadline?.title || post.rssItemTitle || null,
          rssItemLink: matchedHeadline?.link || null,
          sourceType: matchedHeadline?.sourceType || post.sourceType || null,
          newsAngle: post.newsAngle,
          platforms,
          postType: post.postType || 'general',
          status: 'pending_approval',
          tradeAreaZip: businessZip!,
          briefScore: matchedHeadline?.geoConfidence,
          patternType: post.patternType || null,
        },
      });
      createdPosts.push(created);
    }

    // Mark RSS items as used
    const usedItemIds = createdPosts
      .map(p => p.rssItemId)
      .filter((id): id is string => !!id);

    if (usedItemIds.length > 0) {
      await prisma.rssItem.updateMany({
        where: { id: { in: usedItemIds } },
        data: { usedInPost: true, usedAt: new Date() },
      });
    }

    return NextResponse.json({
      posts: createdPosts,
      brief: {
        totalItems: brief.summary.totalItems,
        feedsMatched: brief.summary.feedsMatched,
        patterns: brief.patterns.map(p => p.type),
      },
      meta: {
        businessZip,
        businessName,
        radiusMiles: radius,
        queryTimeMs: Date.now() - start,
      },
    });
  } catch (error: any) {
    console.error('Clark Kent scout error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── LLM Post Generation ──────────────────────────────────────────────────────

interface LlmPostOutput {
  caption: string;
  hashtags: string[];
  rssItemId?: string;
  rssItemTitle?: string;
  sourceType?: string;
  newsAngle: string;
  postType: string;
  patternType?: string;
}

async function generateSocialPosts(
  brief: ContentBrief,
  options: {
    businessName: string | null;
    websiteUrl: string | null;
    platforms: string[];
    postCount: number;
  }
): Promise<LlmPostOutput[]> {
  const { businessName, websiteUrl, platforms, postCount } = options;

  // Build headline summaries for the LLM
  const headlineSummary = brief.headlines
    .slice(0, 20)
    .map((h, i) => `${i + 1}. [ID: ${h.id}] "${h.title}" — ${h.source} (${h.sourceType}, ${h.pubDate?.split('T')[0] || 'recent'})`)
    .join('\n');

  const patternSummary = brief.patterns
    .map(p => `• ${p.type}: ${p.description}`)
    .join('\n');

  const prompt = `You are Clark Kent, a local news scout for small businesses. Your job is to find the best local stories and turn them into engaging social media posts that a small business owner can share.

BUSINESS CONTEXT:
- Name: ${businessName || 'Local Business'}
- Website: ${websiteUrl || 'N/A'}
- Trade Area: ${brief.tradeAreaCenter} (${brief.radiusMiles} mile radius)
- Target Platforms: ${platforms.join(', ')}

LOCAL NEWS FEED (${brief.summary.totalItems} items from ${brief.summary.feedsMatched} sources):
${headlineSummary}

DETECTED PATTERNS:
${patternSummary || '• No strong patterns detected'}

INSTRUCTIONS:
Pick the ${postCount} BEST stories from the feed above and write a social media post for each. For each post:
1. Choose a story that a local business could naturally share — community events, weather updates, local achievements, government meetings that affect businesses
2. Write a caption that feels authentic, NOT salesy — the business is sharing helpful local info, not promoting itself
3. Keep captions 1-3 sentences, conversational, with a local feel
4. Add 3-5 relevant hashtags (mix of local + topic)
5. Identify the "angle" — why this story matters to local customers
6. Classify the post type: weather_tip, community_event, trending_news, seasonal, general

AVOID:
- Promotional language or CTAs
- Political opinions
- Controversial takes
- Making up information not in the headlines

Respond with raw JSON only:
{
  "posts": [
    {
      "rssItemId": "the ID from the headline list",
      "rssItemTitle": "original headline",
      "caption": "the social post caption",
      "hashtags": ["#Local", "#CommunityNews"],
      "newsAngle": "why this matters to local customers",
      "postType": "community_event",
      "patternType": "community_events",
      "sourceType": "local_news"
    }
  ]
}`;

  const response = await fetch('https://apps.abacus.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ABACUSAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error: ${response.status} — ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty content');

  const parsed = JSON.parse(content);
  return (parsed.posts || []).slice(0, options.postCount);
}
