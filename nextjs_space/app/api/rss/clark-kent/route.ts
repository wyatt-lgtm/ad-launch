export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';
import type { ContentBrief } from '@/lib/rss/trade-area-feed';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';

const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];

const LLM_URL = 'https://apps.abacus.ai/v1/chat/completions';

/**
 * Clark Kent — Social Post Scout (3-Lane Orchestrator)
 *
 * POST /api/rss/clark-kent
 * Body: { analysisId?, zip?, radius? }
 *
 * Generates 9 posts across 3 lanes:
 *   Lane 1 (Clark Kent):  3 posts from RSS feeds (local news)
 *   Lane 2 (Creative):    3 posts from business website/analysis
 *   Lane 3 (Calendar):    3 posts from upcoming holidays & events
 *
 * Every post targets ALL 6 platforms.
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
    const { analysisId, zip: directZip, radius = 25 } = body;

    // ── Resolve business context ───────────────────────────────────────
    let businessZip: string | null = directZip || null;
    let businessName: string | null = null;
    let websiteUrl: string | null = null;
    let businessCity: string | null = null;
    let businessState: string | null = null;
    let resolvedAnalysisId: string | null = analysisId || null;
    let analysisResults: any = null;
    let seoData: any = null;

    if (analysisId) {
      const analysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        select: {
          businessZip: true, businessName: true, websiteUrl: true,
          businessCity: true, businessState: true, results: true, seoData: true,
        },
      });
      if (analysis) {
        businessZip = analysis.businessZip || businessZip;
        businessName = analysis.businessName;
        websiteUrl = analysis.websiteUrl;
        businessCity = analysis.businessCity;
        businessState = analysis.businessState;
        analysisResults = analysis.results;
        seoData = analysis.seoData;
      }
    }

    if (!businessZip) {
      const recentAnalysis = await prisma.analysis.findFirst({
        where: { userId, businessZip: { not: null }, geoConfirmed: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, businessZip: true, businessName: true, websiteUrl: true,
          businessCity: true, businessState: true, results: true, seoData: true,
        },
      });
      if (recentAnalysis) {
        businessZip = recentAnalysis.businessZip;
        businessName = recentAnalysis.businessName;
        websiteUrl = recentAnalysis.websiteUrl;
        businessCity = recentAnalysis.businessCity;
        businessState = recentAnalysis.businessState;
        analysisResults = recentAnalysis.results;
        seoData = recentAnalysis.seoData;
        resolvedAnalysisId = resolvedAnalysisId || recentAnalysis.id;
      }
    }

    if (!businessZip) {
      return NextResponse.json(
        { error: 'No business ZIP available. Please complete a business analysis first or provide a ZIP code.' },
        { status: 400 }
      );
    }

    const bizContext = {
      businessName: businessName || 'Local Business',
      websiteUrl: websiteUrl || '',
      businessCity: businessCity || '',
      businessState: businessState || '',
      businessZip: businessZip!,
    };

    // ── Run all 3 lanes in parallel ────────────────────────────────────
    const [rssPosts, websitePosts, holidayPosts] = await Promise.all([
      generateRssPosts(businessZip!, radius, bizContext),
      generateWebsitePosts(bizContext, analysisResults, seoData),
      generateHolidayPosts(bizContext),
    ]);

    // ── Save all 9 posts ───────────────────────────────────────────────
    const allPosts = [
      ...rssPosts.map(p => ({ ...p, lane: 'rss' as const })),
      ...websitePosts.map(p => ({ ...p, lane: 'website' as const })),
      ...holidayPosts.map(p => ({ ...p, lane: 'holiday' as const })),
    ];

    const createdPosts = [];
    for (const post of allPosts) {
      const created = await prisma.socialPost.create({
        data: {
          userId,
          analysisId: resolvedAnalysisId,
          caption: post.caption,
          hashtags: post.hashtags,
          rssItemId: post.rssItemId || null,
          rssItemTitle: post.rssItemTitle || null,
          rssItemLink: post.rssItemLink || null,
          sourceType: post.sourceType || post.lane,
          newsAngle: post.newsAngle,
          platforms: ALL_PLATFORMS,
          postType: post.postType || 'general',
          status: 'pending_approval',
          tradeAreaZip: businessZip!,
          briefScore: post.briefScore || null,
          patternType: post.patternType || post.lane,
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
      lanes: {
        rss: rssPosts.length,
        website: websitePosts.length,
        holiday: holidayPosts.length,
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

// ══════════════════════════════════════════════════════════════════════════════
// LANE 1: RSS Feed Posts (Clark Kent's specialty)
// ══════════════════════════════════════════════════════════════════════════════

interface GeneratedPost {
  caption: string;
  hashtags: string[];
  rssItemId?: string;
  rssItemTitle?: string;
  rssItemLink?: string;
  sourceType?: string;
  newsAngle: string;
  postType: string;
  patternType?: string;
  briefScore?: number;
}

async function generateRssPosts(
  zip: string,
  radius: number,
  biz: { businessName: string; websiteUrl: string }
): Promise<GeneratedPost[]> {
  try {
    const brief = await generateContentBrief(zip, radius, { days: 5, limit: 30 });
    if (brief.summary.totalItems === 0) return [];

    const headlineSummary = brief.headlines
      .slice(0, 15)
      .map((h, i) => `${i + 1}. [ID: ${h.id}] "${h.title}" — ${h.source} (${h.sourceType}, ${h.pubDate?.split('T')[0] || 'recent'})`)
      .join('\n');

    const patternSummary = brief.patterns
      .map(p => `• ${p.type}: ${p.description}`)
      .join('\n');

    const prompt = `You are Clark Kent, a local news scout for small businesses. Pick the 3 BEST local stories and write social media posts a small business owner can share.

BUSINESS: ${biz.businessName} (${biz.websiteUrl || 'local business'})
TRADE AREA: ${brief.tradeAreaCenter} (${brief.radiusMiles}mi radius)

LOCAL NEWS FEED:
${headlineSummary}

PATTERNS:
${patternSummary || '• None'}

RULES:
- Pick 3 different stories a local business would naturally share
- Captions: 1-3 sentences, conversational, helpful — NOT salesy
- 3-5 hashtags each (mix local + topic)
- Identify the angle: why this matters to local customers
- Post types: weather_tip, community_event, trending_news, general
- NO promotional language, NO political opinions, NO controversy

Respond with raw JSON only:
{"posts": [{"rssItemId": "ID", "rssItemTitle": "headline", "caption": "...", "hashtags": ["#..."], "newsAngle": "why it matters", "postType": "community_event", "patternType": "community_events", "sourceType": "local_news"}]}`;

    const data = await callLLM(prompt);
    const posts = (data.posts || []).slice(0, 3);

    return posts.map((p: any) => {
      const matched = brief.headlines.find(h => h.id === p.rssItemId);
      return {
        ...p,
        rssItemLink: matched?.link || null,
        briefScore: matched?.geoConfidence,
      };
    });
  } catch (err) {
    console.error('RSS lane error:', err);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LANE 2: Website / Business Posts (from analysis data)
// ══════════════════════════════════════════════════════════════════════════════

async function generateWebsitePosts(
  biz: { businessName: string; websiteUrl: string; businessCity: string; businessState: string },
  analysisResults: any,
  seoData: any
): Promise<GeneratedPost[]> {
  try {
    // Extract useful context from analysis
    const ads = analysisResults?.ads || [];
    const adCaptions = ads.slice(0, 3).map((a: any) => a.caption || a.headline || '').filter(Boolean);
    const seoScore = seoData?.score || 'N/A';
    const seoGrade = seoData?.grade || 'N/A';
    const bizSummary = analysisResults?.research?.business_summary || {};
    const coreOffer = bizSummary.core_offer || bizSummary.services || '';
    const targetCustomer = bizSummary.target_customer || bizSummary.audience || '';
    const valueProps = bizSummary.value_propositions || bizSummary.differentiators || [];
    const industry = bizSummary.industry || bizSummary.category || '';

    const prompt = `You are a creative social media manager for a small business. Create 3 social posts that promote the business itself — its story, what it offers, and why the community should care.

BUSINESS CONTEXT:
- Name: ${biz.businessName}
- Website: ${biz.websiteUrl}
- Location: ${biz.businessCity}, ${biz.businessState}
- Industry: ${industry || 'local business'}
- Core Offer: ${coreOffer || 'products and services'}
- Target Customer: ${targetCustomer || 'local community'}
- Value Propositions: ${Array.isArray(valueProps) ? valueProps.join(', ') : valueProps || 'quality local service'}
${adCaptions.length > 0 ? `- Example Ad Copy (for tone reference): "${adCaptions[0]}"` : ''}

CREATE 3 POSTS:
1. A "who we are" post — introduce the business, its mission or story
2. A "what we offer" post — highlight a key product/service with benefits
3. A "why choose us" post — social proof, community connection, or a unique differentiator

RULES:
- Captions: 2-4 sentences, warm and authentic, NOT corporate
- Should feel like a real small business owner wrote them
- 3-5 hashtags each (mix of industry + local + brand)
- Light CTAs are OK ("Stop by", "Check us out", "Link in bio")
- Include the city/area name naturally

Respond with raw JSON only:
{"posts": [{"caption": "...", "hashtags": ["#..."], "newsAngle": "what makes this post compelling", "postType": "promotion", "sourceType": "website"}]}`;

    const data = await callLLM(prompt);
    return (data.posts || []).slice(0, 3).map((p: any) => ({
      caption: p.caption,
      hashtags: p.hashtags || [],
      newsAngle: p.newsAngle || 'Business promotion',
      postType: p.postType || 'promotion',
      sourceType: 'website',
      patternType: 'website',
    }));
  } catch (err) {
    console.error('Website lane error:', err);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LANE 3: Holiday & Event Posts (next 90 days)
// ══════════════════════════════════════════════════════════════════════════════

async function generateHolidayPosts(
  biz: { businessName: string; websiteUrl: string; businessCity: string; businessState: string }
): Promise<GeneratedPost[]> {
  try {
    const events = getUpcomingEvents();
    if (events.length === 0) return [];

    const eventList = events
      .slice(0, 8)
      .map((e, i) => `${i + 1}. ${e.name} (${e.date}) — Ideas: ${e.ideas}`)
      .join('\n');

    const prompt = `You are a creative social media manager for a small business. Create 3 social posts tied to UPCOMING holidays or events in the next 90 days.

BUSINESS CONTEXT:
- Name: ${biz.businessName}
- Website: ${biz.websiteUrl}
- Location: ${biz.businessCity}, ${biz.businessState}

UPCOMING EVENTS (next 90 days):
${eventList}

CREATE 3 POSTS:
- Pick the 3 most relevant/impactful events for a local business
- Tie the business naturally to each event (NOT forced)
- Mix: 1 celebratory/fun, 1 promotional/seasonal offer, 1 community/gratitude

RULES:
- Captions: 2-4 sentences, festive and timely, appropriate to the holiday
- Should feel authentic — a real business getting into the spirit
- 3-5 hashtags each (holiday name + local + business)
- Mention the specific date or time frame
- Light CTAs are OK for the promotional one

Respond with raw JSON only:
{"posts": [{"caption": "...", "hashtags": ["#..."], "newsAngle": "why this event matters for the business", "postType": "seasonal", "sourceType": "holiday", "eventName": "the holiday name"}]}`;

    const data = await callLLM(prompt);
    return (data.posts || []).slice(0, 3).map((p: any) => ({
      caption: p.caption,
      hashtags: p.hashtags || [],
      newsAngle: p.newsAngle || 'Seasonal content',
      postType: p.postType || 'seasonal',
      sourceType: 'holiday',
      patternType: 'holiday',
      rssItemTitle: p.eventName || null,
    }));
  } catch (err) {
    console.error('Holiday lane error:', err);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Shared LLM caller
// ══════════════════════════════════════════════════════════════════════════════

async function callLLM(prompt: string): Promise<any> {
  const response = await fetch(LLM_URL, {
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
  return JSON.parse(content);
}
