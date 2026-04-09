export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getMultiWorkflowStatus, getWorkflowResults, getSocialWorkflowResults } from '@/lib/tombstone';

const TOMBSTONE_API = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/** Resolve an R2 key (or stale presigned URL) to a fresh presigned URL.
 *  S3 public URLs (from GPT-5.1 generation) are passed through directly.
 *  Data URLs are also passed through.
 */
async function resolveImageUrl(keyOrUrl: string | null): Promise<string | null> {
  if (!keyOrUrl) return null;

  // Pass through data URLs
  if (keyOrUrl.startsWith('data:')) return keyOrUrl;

  // Pass through S3 public URLs (our GPT-5.1 generated images)
  if (keyOrUrl.includes('.s3.') && keyOrUrl.includes('amazonaws.com')) return keyOrUrl;

  let r2Key = keyOrUrl;
  if (r2Key.startsWith('http')) {
    try {
      const parsed = new URL(r2Key);
      let path = parsed.pathname.replace(/^\/+/, '');
      if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
      r2Key = path;
    } catch { return keyOrUrl; }
  }
  try {
    const res = await fetch(
      `${TOMBSTONE_API}/artifacts/resolve?artifact_path=${encodeURIComponent(r2Key)}`,
      { cache: 'no-store' },
    );
    const data = await res.json().catch(() => ({}));
    return data?.artifact_url ?? keyOrUrl;
  } catch { return keyOrUrl; }
}

/** Resolve image URLs for an array of ad objects. */
async function resolveAdImages(ads: any[]): Promise<any[]> {
  return Promise.all(
    ads.map(async (ad: any) => ({
      ...ad,
      imageUrl: await resolveImageUrl(ad?.imageUrl ?? null),
    })),
  );
}
import { runSeoAudit } from '@/lib/seo-audit';
import { extractBusinessAddress, parseGeoString, type ExtractedAddress } from '@/lib/address-extractor';
// GPT-5.1 image generation moved to /api/upgrade-ad-images (async, fire-and-forget)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const analysisId = searchParams.get('analysisId');
    if (!analysisId) {
      return NextResponse.json({ error: 'analysisId required' }, { status: 400 });
    }

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { ads: true },
    });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Parse lane workflows from missionId (used in all response paths)
    let laneWorkflows: Record<string, string | string[]> = {};
    if (analysis.missionId) {
      try {
        const parsed = JSON.parse(analysis.missionId);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          laneWorkflows = parsed;
        }
      } catch { /* legacy comma-separated — no lane info */ }
    }

    // If already completed with ads, return cached results with fresh image URLs
    if ((analysis.status === 'completed' || analysis.status === 'completing') && (analysis.ads?.length ?? 0) > 0) {
      const freshAds = await resolveAdImages(analysis.ads ?? []);
      const cachedResults = (analysis.results ?? {}) as any;
      // Inject live location data from DB (may have been confirmed/edited by user)
      const seoData = analysis.seoData as any ?? {};
      if (analysis.businessCity || analysis.businessState || analysis.businessZip) {
        seoData.location = {
          address: analysis.businessAddr ?? '',
          city: analysis.businessCity ?? '',
          state: analysis.businessState ?? '',
          zip: analysis.businessZip ?? '',
          phone: analysis.businessPhone ?? '',
          source: analysis.geoSource ?? 'none',
          confidence: 1,
          confirmed: analysis.geoConfirmed ?? false,
        };
      }
      // Check if social workflow is still running
      let socialStatus = 'completed';
      if (analysis.socialMissionId) {
        const socialWfIds = analysis.socialMissionId.split(',').filter(Boolean);
        try {
          const sr = await getSocialWorkflowResults(socialWfIds);
          socialStatus = sr.status;
          // Store posts if they just completed and haven't been stored yet
          if (sr.status === 'completed' && sr.posts.length > 0 && analysis.userId) {
            const existingCount = await prisma.socialPost.count({ where: { analysisId: analysis.id } });
            if (existingCount === 0) {
              const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];
              for (const post of sr.posts) {
                await prisma.socialPost.create({
                  data: {
                    userId: analysis.userId,
                    analysisId: analysis.id,
                    caption: post.caption || '',
                    hashtags: post.hashtags || [],
                    imageUrl: post.imageUrl || null,
                    imagePrompt: post.imagePrompt || null,
                    sourceType: post.sourceType || null,
                    newsAngle: post.newsAngle || null,
                    platforms: post.platforms || ALL_PLATFORMS,
                    postType: post.postType || 'general',
                    status: 'pending_approval',
                    tradeAreaZip: analysis.businessZip || null,
                    patternType: post.patternType || null,
                    rssItemTitle: post.rssItemTitle || null,
                    rssItemLink: post.rssItemLink || null,
                  },
                });
              }
              console.log(`[mission-status] Late-stored ${sr.posts.length} social posts`);
            }
          }
        } catch { /* ignore */ }
      }

      return NextResponse.json({
        status: 'completed',
        ads: freshAds,
        seoData,
        postingPlan: analysis.postingPlan ?? null,
        googleAdsData: cachedResults.googleAds ?? null,
        websiteConceptData: cachedResults.websiteConcept ?? null,
        budgetData: cachedResults.budget ?? null,
        socialStatus,
        laneWorkflows,
        tasks: [], // No need to poll tasks anymore
      });
    }

    // If pending location confirmation or no mission ID yet, return current status
    if (analysis.status === 'pending_location' || !analysis.missionId) {
      return NextResponse.json({ status: analysis.status, tasks: [] });
    }

    // Build flat array of workflow IDs from laneWorkflows or legacy comma-separated
    let workflowIds: string[] = [];
    if (Object.keys(laneWorkflows).length > 0) {
      // Flatten — each lane value can be a string or array of strings (from generate-more)
      for (const v of Object.values(laneWorkflows)) {
        if (Array.isArray(v)) workflowIds.push(...v);
        else if (v) workflowIds.push(v);
      }
    } else if (analysis.missionId) {
      workflowIds = analysis.missionId.split(',').filter(Boolean);
    }

    // Poll Tombstone for status
    const statusResult = await getMultiWorkflowStatus(workflowIds);
    const overallStatus = statusResult?.status ?? 'processing';

    console.log(`[mission-status] analysisId=${analysisId} workflows=${workflowIds.length} overallStatus=${overallStatus} tasks=${statusResult.tasks?.length ?? 0}`);

    if (overallStatus === 'completed') {
      // Guard: prevent duplicate ad creation from concurrent poll requests.
      // Use an atomic status update — only proceed if we successfully transition from non-completed to 'completed'.
      const lockResult = await prisma.analysis.updateMany({
        where: { id: analysisId, status: { notIn: ['completed', 'completing'] } },
        data: { status: 'completing' },
      });

      if (lockResult.count === 0) {
        // Another request already started completion — check if it finished or timed out
        const refetched = await prisma.analysis.findUnique({
          where: { id: analysisId },
          include: { ads: true },
        });

        if (refetched?.status === 'completed' && (refetched.ads?.length ?? 0) > 0) {
          const freshAds = await resolveAdImages(refetched.ads ?? []);
          const cachedResults = (refetched.results ?? {}) as any;
          return NextResponse.json({
            status: 'completed',
            ads: freshAds,
            seoData: refetched.seoData ?? null,
            postingPlan: refetched.postingPlan ?? null,
            googleAdsData: cachedResults.googleAds ?? null,
            websiteConceptData: cachedResults.websiteConcept ?? null,
            budgetData: cachedResults.budget ?? null,
            tasks: [],
          });
        }

        // Timeout recovery: if stuck in 'completing' for > 5 minutes, reset to allow retry
        if (refetched?.status === 'completing' && refetched.updatedAt) {
          const stuckMs = Date.now() - new Date(refetched.updatedAt).getTime();
          if (stuckMs > 5 * 60 * 1000) {
            console.warn(`[mission-status] analysisId=${analysisId} stuck in 'completing' for ${Math.round(stuckMs / 1000)}s — resetting to processing`);
            await prisma.analysis.update({
              where: { id: analysisId },
              data: { status: 'processing' },
            });
            // Next poll will re-attempt the lock
          }
        }

        // Still completing — tell frontend to keep polling
        console.log(`[mission-status] analysisId=${analysisId} completion in progress, returning pending`);
        return NextResponse.json({ status: 'processing', tasks: statusResult.tasks ?? [] });
      }

      // We won the lock — proceed with ad creation (FAST path: use Tombstone images first)
      try {
        // Fetch full results
        const results = await getWorkflowResults(workflowIds);

        // Build SEO data from Zig's audit (or fallback to live audit)
        const seoData = await buildSeoData(results.research, results.creative, results.marketing, analysis.websiteUrl, analysisId);
        const postingPlan = buildPostingPlan(results.research, results.creative, results.marketing, analysis.websiteUrl);
        const googleAdsData = buildGoogleAds(results.research, results.creative, analysis.websiteUrl);
        const websiteConceptData = buildWebsiteConcept(results.research, results.creative, analysis.websiteUrl);
        const budgetData = buildBudgetRecommendations(results.research, analysis.websiteUrl);

        // Build reverse map: workflowId → lane name
        const wfToLane: Record<string, string> = {};
        for (const [lane, wfIdOrArr] of Object.entries(laneWorkflows)) {
          if (Array.isArray(wfIdOrArr)) {
            for (const wfId of wfIdOrArr) wfToLane[wfId] = lane;
          } else if (wfIdOrArr) {
            wfToLane[wfIdOrArr] = lane;
          }
        }

        // Create ad records IMMEDIATELY with Tombstone images (fast — no GPT-5.1 blocking)
        const adsToCreate = results.ads;
        console.log(`[mission-status] Creating ${adsToCreate.length} ads with Tombstone images (fast path)`);
        for (let i = 0; i < adsToCreate.length; i++) {
          const ad = adsToCreate[i];
          let imageKey = ad?.imageUrl ?? null;

          // Extract R2 key from presigned URL
          if (imageKey && imageKey.startsWith('http') && !imageKey.includes('.s3.')) {
            try {
              const parsed = new URL(imageKey);
              let path = parsed.pathname.replace(/^\/+/, '');
              if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
              imageKey = path;
            } catch {}
          }

          await prisma.ad.create({
            data: {
              analysisId: analysis.id,
              imageUrl: imageKey,
              caption: ad?.caption ?? '',
              headline: ad?.headline ?? 'Ad',
              watermarked: true,
              lane: wfToLane[ad?.workflowId] ?? null,
            },
          });
        }

        await prisma.analysis.update({
          where: { id: analysisId },
          data: {
            status: 'completed',
            results: { ...results as any, googleAds: googleAdsData, websiteConcept: websiteConceptData, budget: budgetData } as any,
            seoData: seoData as any,
            postingPlan: postingPlan as any,
          },
        });

        const updatedAnalysis = await prisma.analysis.findUnique({
          where: { id: analysisId },
          include: { ads: true },
        });

        // Resolve fresh presigned URLs for ads just stored
        const freshAds = await resolveAdImages(updatedAnalysis?.ads ?? []);

        // Fire-and-forget: upgrade Tombstone images to GPT-5.1 in background
        const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
        console.log(`[mission-status] Firing background GPT-5.1 upgrade for analysisId=${analysisId}`);
        fetch(`${baseUrl}/api/upgrade-ad-images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId }),
        }).catch((err) => {
          console.error('[mission-status] Failed to trigger image upgrade:', err?.message);
        });

        // Check social workflow progress (runs in parallel with ads)
        let socialStatus = 'pending';
        if (analysis.socialMissionId) {
          const socialWorkflowIds = analysis.socialMissionId.split(',').filter(Boolean);
          try {
            const socialResult = await getSocialWorkflowResults(socialWorkflowIds);
            socialStatus = socialResult.status;

            if (socialResult.status === 'completed' && socialResult.posts.length > 0) {
              // Store Tombstone-generated social posts
              const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];
              for (const post of socialResult.posts) {
                await prisma.socialPost.create({
                  data: {
                    userId: analysis.userId!,
                    analysisId: analysis.id,
                    caption: post.caption || '',
                    hashtags: post.hashtags || [],
                    imageUrl: post.imageUrl || null,
                    imagePrompt: post.imagePrompt || null,
                    sourceType: post.sourceType || null,
                    newsAngle: post.newsAngle || null,
                    platforms: post.platforms || ALL_PLATFORMS,
                    postType: post.postType || 'general',
                    status: 'pending_approval',
                    tradeAreaZip: analysis.businessZip || null,
                    patternType: post.patternType || null,
                    rssItemTitle: post.rssItemTitle || null,
                    rssItemLink: post.rssItemLink || null,
                  },
                });
              }
              console.log(`[mission-status] Stored ${socialResult.posts.length} social posts from Tombstone`);
            }
          } catch (err: any) {
            console.error('[mission-status] Social workflow check failed:', err?.message);
          }
        }

        return NextResponse.json({
          status: 'completed',
          ads: freshAds,
          seoData,
          postingPlan,
          googleAdsData,
          websiteConceptData,
          budgetData,
          socialStatus,
          laneWorkflows,
          tasks: statusResult.tasks ?? [],
        });
      } catch (err: any) {
        // If completion fails, reset status so it can be retried
        console.error('[mission-status] Completion failed, resetting status:', err?.message);
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: 'processing' },
        });
        return NextResponse.json({ error: 'Failed to process results', tasks: [] }, { status: 500 });
      }
    }

    // Update status in DB if changed (never overwrite 'completing' or 'completed')
    const mappedStatus = overallStatus === 'error' ? 'error' : overallStatus === 'generating' ? 'generating' : 'processing';
    if (analysis.status !== mappedStatus && analysis.status !== 'completing' && analysis.status !== 'completed') {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: mappedStatus },
      });
    }

    // Extract error reason from failed tasks if any
    let errorReason: string | null = null;
    if (mappedStatus === 'error') {
      const failedTask = (statusResult.tasks ?? []).find((t: any) => t.status === 'error' && t.lastError);
      if (failedTask?.lastError) {
        // Clean up internal error messages for user display
        const raw = failedTask.lastError as string;
        if (raw.includes('terms violation')) {
          errorReason = 'This website could not be analyzed. It may be too large or have access restrictions. Please try a different URL.';
        } else if (raw.includes('timeout') || raw.includes('Timeout')) {
          errorReason = 'The website took too long to respond. Please try again.';
        } else {
          errorReason = 'Post generation encountered an issue. Please try again.';
        }
        console.log(`[mission-status] Error reason: ${raw}`);
      }
    }

    return NextResponse.json({
      status: mappedStatus,
      tasks: statusResult.tasks ?? [],
      laneWorkflows,
      ...(errorReason ? { errorReason } : {}),
    });
  } catch (err: any) {
    console.error('Mission status error:', err);
    return NextResponse.json({ error: 'Failed to check status', tasks: [] }, { status: 500 });
  }
}

/**
 * Build SEO data from Zig's pipeline audit (preferred) or fallback to live audit.
 */
async function buildSeoData(research: any, creative: any, marketing: any, websiteUrl: string, analysisId?: string) {
  // Prefer Zig's SEO audit from the pipeline (already ran in parallel with creative)
  let audit = marketing?.audit ?? null;
  let auditHtml = '';
  if (audit) {
    console.log(`[seo-audit] Using Zig pipeline audit: score=${audit.score} grade=${audit.grade}`);
  } else {
    // Fallback: run live SEO audit (adds latency at completion time)
    try {
      audit = await runSeoAudit(websiteUrl);
      console.log(`[seo-audit] Fallback live audit ${websiteUrl}: score=${audit.score} grade=${audit.grade}`);
    } catch (err: any) {
      console.error('[seo-audit] Error:', err?.message);
    }
  }

  // --- Address extraction ---
  // Try to fetch HTML for address extraction (reuse if audit already has it)
  let location: ExtractedAddress | null = null;
  try {
    const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(baseUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'AdLaunch-SEO-Audit/1.0' },
        cache: 'no-store',
      });
      auditHtml = await res.text().catch(() => '');
    } finally {
      clearTimeout(timer);
    }
    if (auditHtml) {
      location = extractBusinessAddress(auditHtml);
      console.log(`[address-extractor] source=${location.source} confidence=${location.confidence} city=${location.city} state=${location.state} zip=${location.zip}`);
    }
  } catch (err: any) {
    console.error('[address-extractor] Fetch error:', err?.message);
  }

  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const constraints = research?.messaging_constraints ?? {};
  const geoString = biz?.geo ?? '';

  // Merge: HTML extraction wins, research pipeline geo is fallback
  if ((!location || location.source === 'none') && geoString) {
    const parsed = parseGeoString(geoString);
    if (parsed.state) {
      location = {
        businessName: biz?.name ?? '',
        address: '',
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
        phone: '',
        source: 'none', // will be recorded as 'research_pipeline' in DB
        confidence: 0.3,
      };
      console.log(`[address-extractor] Using research pipeline geo: "${geoString}" → city=${parsed.city} state=${parsed.state}`);
    }
  }

  // Store extracted location in Analysis record
  if (analysisId && location && location.source !== 'none') {
    try {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          businessName: location.businessName || biz?.name || null,
          businessAddr: location.address || null,
          businessCity: location.city || null,
          businessState: location.state || null,
          businessZip: location.zip || null,
          businessPhone: location.phone || null,
          geoSource: location.source,
          geoConfirmed: false,
        },
      });
      console.log(`[address-extractor] Saved to Analysis ${analysisId}`);
    } catch (err: any) {
      console.error('[address-extractor] DB save error:', err?.message);
    }
  } else if (analysisId && geoString) {
    // Even if extraction failed, save the raw geo from research pipeline
    const parsed = parseGeoString(geoString);
    try {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          businessName: biz?.name || null,
          businessCity: parsed.city || null,
          businessState: parsed.state || null,
          businessZip: parsed.zip || null,
          geoSource: 'research_pipeline',
          geoConfirmed: false,
        },
      });
    } catch (err: any) {
      console.error('[address-extractor] DB fallback save error:', err?.message);
    }
  }

  return {
    businessName: biz?.name ?? 'Unknown',
    industry: biz?.category ?? 'Unknown',
    coreOffer: biz?.core_offer ?? '',
    targetCustomer: biz?.target_customer ?? '',
    products: biz?.products ?? [],
    geo: geoString,
    location: location ? {
      address: location.address,
      city: location.city,
      state: location.state,
      zip: location.zip,
      phone: location.phone,
      source: location.source,
      confidence: location.confidence,
      confirmed: false,
    } : null,
    brandVoice: {
      tone: voice?.tone ?? '',
      style: voice?.style ?? '',
    },
    keyTopics: constraints?.allowed_topics ?? [],
    avoidTopics: constraints?.forbidden_topics ?? [],
    websiteUrl,
    audit, // <-- Full SEO audit with score 0-100, grade, and items
    recommendations: audit?.items
      ?.filter((i: any) => i.status === 'fail' || i.status === 'warn')
      .map((i: any) => `${i.status === 'fail' ? '🔴' : '🟡'} ${i.label}: ${i.detail}`) ?? [],
  };
}

/**
 * Get upcoming calendar events within the next 90 days for content planning.
 */
function getUpcomingEvents(): { name: string; date: string; week: number; ideas: string }[] {
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const fixedHolidays: { name: string; month: number; day: number; ideas: string }[] = [
    { name: "New Year's Day", month: 0, day: 1, ideas: 'New year goals, fresh start promos, year-in-review' },
    { name: "Valentine's Day", month: 1, day: 14, ideas: 'Gift guides, couples/partner promos, love-themed content' },
    { name: "St. Patrick's Day", month: 2, day: 17, ideas: 'Green-themed posts, community celebration content, festive deals' },
    { name: "Mother's Day", month: 4, day: 11, ideas: 'Gift guides, family celebration content, honor moms with special offers' },
    { name: "Memorial Day", month: 4, day: 26, ideas: 'Patriotic content, summer kickoff promos, community BBQ/cookout themes' },
    { name: "Father's Day", month: 5, day: 15, ideas: 'Gift guides, dad-themed content, family gathering promos' },
    { name: "Independence Day", month: 6, day: 4, ideas: 'Patriotic content, summer celebration promos, community events' },
    { name: "Labor Day", month: 8, day: 1, ideas: 'End of summer promos, back-to-work content, fall transition' },
    { name: "Halloween", month: 9, day: 31, ideas: 'Spooky-themed content, costume contests, fall festival promos' },
    { name: "Veterans Day", month: 10, day: 11, ideas: 'Honor veterans, special discounts for military, community gratitude' },
    { name: "Thanksgiving", month: 10, day: 27, ideas: 'Gratitude posts, family gathering content, Black Friday preview' },
    { name: "Black Friday", month: 10, day: 28, ideas: 'Biggest deals of the year, limited-time offers, doorbusters' },
    { name: "Small Business Saturday", month: 10, day: 29, ideas: 'Support local, shop small promos, community spotlight' },
    { name: "Cyber Monday", month: 11, day: 1, ideas: 'Online-exclusive deals, digital promotions, flash sales' },
    { name: "Christmas", month: 11, day: 25, ideas: 'Holiday specials, gift guides, year-end celebrations, family content' },
    { name: "New Year's Eve", month: 11, day: 31, ideas: 'Year-end wrap-up, countdown content, early-bird next year promos' },
  ];

  // Easter (variable date - compute for current and next year)
  function computeEaster(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
  }

  const events: { name: string; date: string; week: number; ideas: string }[] = [];

  for (const h of fixedHolidays) {
    for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
      const d = new Date(year, h.month, h.day);
      if (d >= now && d <= end) {
        const weekNum = Math.ceil((d.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000));
        events.push({
          name: h.name,
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          week: Math.max(1, Math.min(12, weekNum)),
          ideas: h.ideas,
        });
      }
    }
  }

  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const easter = computeEaster(year);
    if (easter >= now && easter <= end) {
      const weekNum = Math.ceil((easter.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000));
      events.push({
        name: 'Easter',
        date: easter.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        week: Math.max(1, Math.min(12, weekNum)),
        ideas: 'Spring renewal themes, family gathering content, special brunch/meal promos, community celebration',
      });
    }
  }

  return events.sort((a, b) => a.week - b.week);
}

/**
 * Build a 90-day posting plan from research data with calendar-aware events.
 */
function buildPostingPlan(research: any, creative: any, marketing?: any, websiteUrl?: string) {
  // Extract business info from research, marketing content, or creative — whichever is available
  const biz = research?.business_summary ?? {};
  const topics = research?.messaging_constraints?.allowed_topics ?? [];

  // Fallback: try to extract a business name from marketing content or website URL
  let businessName = biz?.name ?? '';
  let coreOffer = biz?.core_offer ?? '';
  let targetCustomer = biz?.target_customer ?? '';

  if (!businessName && marketing?.content) {
    // Try to extract from marketing content header (e.g. "3 Minimal Facebook Ad Concepts for SimNet Wireless")
    const headerMatch = marketing.content.match(/(?:for|For)\s+([A-Z][A-Za-z0-9\s&'.-]+?)(?:\n|$)/);
    if (headerMatch) businessName = headerMatch[1].trim();
  }
  if (!businessName && websiteUrl) {
    try {
      const host = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, '');
      businessName = host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
    } catch { /* ignore */ }
  }
  if (!businessName) businessName = 'Your Business';

  // Fallback: extract topics from creative ads headlines/captions
  if (topics.length === 0 && creative?.ads?.length) {
    for (const ad of creative.ads) {
      if (ad?.headline) topics.push(ad.headline);
    }
  }

  if (!coreOffer) coreOffer = 'your products/services';
  if (!targetCustomer) targetCustomer = 'your target audience';

  const upcomingEvents = getUpcomingEvents();
  const phase1Events = upcomingEvents.filter(e => e.week <= 4);
  const phase2Events = upcomingEvents.filter(e => e.week > 4 && e.week <= 8);
  const phase3Events = upcomingEvents.filter(e => e.week > 8 && e.week <= 12);

  function buildEventScheduleItems(events: typeof upcomingEvents) {
    return events.map(e => ({
      day: e.date,
      type: '\u{1F389} ' + e.name,
      example: e.ideas,
    }));
  }

  return {
    businessName,
    overview: `A strategic 90-day social media plan for ${businessName} targeting ${targetCustomer}. This plan builds awareness, drives engagement, and converts followers into customers \u2014 with upcoming holidays and events built in for timely content.`,
    upcomingEvents: upcomingEvents.slice(0, 10),
    phases: [
      {
        name: 'Phase 1: Foundation & Awareness',
        weeks: 'Weeks 1-4',
        goal: 'Establish brand presence and build initial audience',
        frequency: '4 posts per week',
        contentMix: [
          { type: 'Brand Story', percent: 30, description: `Introduce ${businessName} \u2014 who you are, what you do, and why you do it` },
          { type: 'Value Posts', percent: 40, description: `Educational content about ${coreOffer} that solves problems for ${targetCustomer}` },
          { type: 'Social Proof', percent: 20, description: 'Customer testimonials, reviews, and success stories' },
          { type: 'Behind the Scenes', percent: 10, description: 'Team photos, process videos, day-in-the-life content' },
        ],
        weeklySchedule: [
          { day: 'Monday', type: 'Value Post', example: topics[0] ? `Tip: ${topics[0]}` : 'Educational tip related to your industry' },
          { day: 'Wednesday', type: 'Brand Story', example: `Why ${businessName} exists and the problem we solve` },
          { day: 'Friday', type: 'Social Proof', example: 'Customer spotlight or testimonial' },
          { day: 'Saturday', type: 'Engagement', example: 'Poll, question, or community-building post' },
          ...buildEventScheduleItems(phase1Events),
        ],
      },
      {
        name: 'Phase 2: Engagement & Authority',
        weeks: 'Weeks 5-8',
        goal: 'Deepen relationships and establish expertise',
        frequency: '5 posts per week',
        contentMix: [
          { type: 'Educational Content', percent: 35, description: `Deep dives on ${coreOffer} \u2014 how-tos, guides, comparisons` },
          { type: 'Customer Stories', percent: 25, description: 'Detailed case studies and transformation stories' },
          { type: 'Promotional', percent: 20, description: 'Product features, limited offers, and clear CTAs' },
          { type: 'Interactive', percent: 20, description: 'Q&A sessions, polls, live videos, community engagement' },
        ],
        weeklySchedule: [
          { day: 'Monday', type: 'Educational', example: topics[1] ? `Guide: ${topics[1]}` : 'How-to guide' },
          { day: 'Tuesday', type: 'Customer Story', example: 'Before/after or success story' },
          { day: 'Wednesday', type: 'Promotional', example: `Feature spotlight: ${coreOffer}` },
          { day: 'Friday', type: 'Interactive', example: 'Q&A or poll about industry topic' },
          { day: 'Saturday', type: 'Behind Scenes', example: 'Team or process spotlight' },
          ...buildEventScheduleItems(phase2Events),
        ],
      },
      {
        name: 'Phase 3: Conversion & Scale',
        weeks: 'Weeks 9-12',
        goal: 'Drive sales and scale what works',
        frequency: '5-6 posts per week',
        contentMix: [
          { type: 'Conversion Posts', percent: 35, description: 'Direct offers, urgency-driven CTAs, limited-time deals' },
          { type: 'Social Proof', percent: 25, description: 'Reviews, UGC, metrics, and results showcases' },
          { type: 'Retargeting Content', percent: 20, description: 'Objection-handling, FAQ posts, comparison content' },
          { type: 'Community', percent: 20, description: 'User-generated content, celebrations, milestone posts' },
        ],
        weeklySchedule: [
          { day: 'Monday', type: 'Social Proof', example: 'Customer review or result metrics' },
          { day: 'Tuesday', type: 'Conversion', example: `Special offer for ${coreOffer}` },
          { day: 'Wednesday', type: 'Retargeting', example: 'Addressing common objections or FAQs' },
          { day: 'Thursday', type: 'Educational', example: topics[2] ? `Pro tip: ${topics[2]}` : 'Expert insight' },
          { day: 'Friday', type: 'Conversion', example: 'Weekend special or limited-time CTA' },
          { day: 'Saturday', type: 'Community', example: 'Customer spotlight or milestone celebration' },
          ...buildEventScheduleItems(phase3Events),
        ],
      },
    ],
    kpis: [
      { metric: 'Follower Growth', target: '+25-40% over 90 days', description: 'Organic audience building' },
      { metric: 'Engagement Rate', target: '3-6% per post', description: 'Likes, comments, shares' },
      { metric: 'Click-Through Rate', target: '1.5-3%', description: 'Traffic to website from posts' },
      { metric: 'Lead Generation', target: '10-30 qualified leads/month', description: 'From social to pipeline' },
      { metric: 'Conversion Rate', target: '2-5% of social traffic', description: 'Social visitors who become customers' },
    ],
    ctaMessage: `Ready to execute this plan? Our team can manage your entire social media presence \u2014 content creation, scheduling, community management, and performance reporting \u2014 so you can focus on running ${businessName}.`,
  };
}


/**
 * Build Google Search Ad copy from research and creative data.
 */
function buildGoogleAds(research: any, creative: any, websiteUrl: string) {
  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const constraints = research?.messaging_constraints ?? {};
  const ads = creative?.ads ?? [];

  const businessName = biz?.name ?? 'Your Business';
  const coreOffer = biz?.core_offer ?? 'our services';
  const targetCustomer = biz?.target_customer ?? 'customers';
  const category = biz?.category ?? 'business';
  const geo = biz?.geo ?? '';

  // Build display URL
  let displayUrl = websiteUrl;
  try {
    const parsed = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    displayUrl = parsed.hostname.replace(/^www\./, '');
  } catch { /* keep as-is */ }

  // Generate headlines from ad copy
  const headlines: string[] = [];
  if (ads[0]?.headline) headlines.push(ads[0].headline.slice(0, 30));
  headlines.push(`${businessName} | ${category}`.slice(0, 30));
  headlines.push(`Top ${category} ${geo ? 'in ' + geo : 'Near You'}`.slice(0, 30));
  if (coreOffer !== 'our services') headlines.push(`Get ${coreOffer}`.slice(0, 30));
  headlines.push(`Trusted ${category} Services`.slice(0, 30));
  if (ads[1]?.headline) headlines.push(ads[1].headline.slice(0, 30));
  // Ensure at least 5 unique headlines
  const uniqueHeadlines = [...new Set(headlines)].slice(0, 6);

  // Generate descriptions
  const descriptions: string[] = [];
  if (ads[0]?.body_copy) descriptions.push(ads[0].body_copy.slice(0, 90));
  descriptions.push(`${businessName} offers ${coreOffer} for ${targetCustomer}. Contact us today!`.slice(0, 90));
  descriptions.push(`Looking for ${category}? ${businessName} delivers quality results. Get started now.`.slice(0, 90));
  if (ads[1]?.body_copy) descriptions.push(ads[1].body_copy.slice(0, 90));
  const uniqueDescriptions = [...new Set(descriptions)].slice(0, 4);

  // Generate keywords
  const keywords: string[] = [];
  const allowedTopics = constraints?.allowed_topics ?? [];
  keywords.push(category);
  keywords.push(`${category} ${geo ?? 'near me'}`);
  keywords.push(`best ${category}`);
  keywords.push(businessName.toLowerCase());
  if (coreOffer !== 'our services') keywords.push(coreOffer.toLowerCase());
  for (const topic of allowedTopics.slice(0, 5)) {
    if (typeof topic === 'string') keywords.push(topic.toLowerCase());
  }
  keywords.push(`${category} services`);
  keywords.push(`local ${category}`);
  const uniqueKeywords = [...new Set(keywords)].slice(0, 10);

  // Sitelink extensions
  const sitelinks = [
    { title: 'Our Services', description: `View all ${category} services we offer` },
    { title: 'About Us', description: `Learn why ${businessName} is trusted` },
    { title: 'Contact Us', description: 'Get in touch for a free consultation' },
    { title: 'Reviews', description: 'See what our customers say about us' },
  ];

  return {
    businessName,
    websiteUrl,
    displayUrl,
    headlines: uniqueHeadlines,
    descriptions: uniqueDescriptions,
    keywords: uniqueKeywords,
    sitelinks,
  };
}

/**
 * Build website concept copy from research data.
 */
function buildWebsiteConcept(research: any, creative: any, websiteUrl: string) {
  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const ads = creative?.ads ?? [];

  const businessName = biz?.name ?? 'Your Business';
  const coreOffer = biz?.core_offer ?? 'our services';
  const targetCustomer = biz?.target_customer ?? 'customers';
  const category = biz?.category ?? '';
  const products = biz?.products ?? [];
  const tone = voice?.tone ?? 'Professional and friendly';

  // Hero section
  const heroHeadline = ads[0]?.headline ?? `Welcome to ${businessName}`;
  const heroDescription = ads[0]?.body_copy
    ?? `We help ${targetCustomer} with ${coreOffer}. Experience the difference that comes from working with a team that genuinely cares about your success.`;
  const heroCta = ads[0]?.cta ?? 'Get Started Today';

  // About section
  const aboutDescription = `${businessName} is dedicated to providing exceptional ${coreOffer} for ${targetCustomer}. Our ${tone.toLowerCase()} approach ensures every client receives personalized attention and outstanding results. We believe in building lasting relationships based on trust, transparency, and tangible outcomes.`;

  // Services section
  const serviceItems = products.length > 0
    ? products.slice(0, 6).map((p: any) => typeof p === 'string' ? p : p?.name ?? '')
    : [`${category} consultation`, `Custom ${coreOffer}`, 'Ongoing support & maintenance'];

  // CTA section
  const ctaHeadline = ads[2]?.headline ?? `Ready to Get Started with ${businessName}?`;
  const ctaDescription = `Take the first step toward better ${coreOffer}. Contact us today for a free consultation and discover how ${businessName} can help ${targetCustomer} achieve their goals.`;

  const sections = [
    {
      title: 'Hero Section',
      headline: heroHeadline,
      description: heroDescription,
      cta: heroCta,
    },
    {
      title: 'About Us',
      headline: `About ${businessName}`,
      description: aboutDescription,
      cta: 'Learn More About Us',
    },
    {
      title: 'Services / Offerings',
      headline: `What We Offer`,
      description: `Explore our comprehensive range of ${category || 'services'} designed to meet your needs.`,
      items: serviceItems,
      cta: 'View All Services',
    },
    {
      title: 'Call to Action',
      headline: ctaHeadline,
      description: ctaDescription,
      cta: 'Contact Us Now',
    },
  ];

  // Suggested color palette based on brand voice
  const colorPalette = [
    { hex: '#2563EB', name: 'Primary' },
    { hex: '#1E293B', name: 'Dark' },
    { hex: '#F8FAFC', name: 'Light' },
    { hex: '#0EA5E9', name: 'Accent' },
    { hex: '#10B981', name: 'Success' },
  ];

  return {
    businessName,
    sections,
    colorPalette,
  };
}

/**
 * Build budget recommendations.
 */
function buildBudgetRecommendations(research: any, websiteUrl: string) {
  const biz = research?.business_summary ?? {};
  const businessName = biz?.name ?? 'Your Business';

  return {
    businessName,
    tiers: [
      {
        name: 'Starter',
        range: '$500-$1,000/mo',
        description: 'Ideal for businesses just starting with digital advertising. Focus on brand awareness and testing.',
        expectedResults: '5K-15K impressions/mo, 100-500 clicks',
      },
      {
        name: 'Growth',
        range: '$1,000-$3,000/mo',
        description: 'For businesses ready to scale. Balanced approach with prospecting and retargeting.',
        expectedResults: '15K-50K impressions/mo, 500-2K clicks, 10-50 leads',
      },
      {
        name: 'Scale',
        range: '$3,000-$5,000+/mo',
        description: 'Full-funnel strategy with aggressive prospecting, retargeting, and conversion optimization.',
        expectedResults: '50K-150K impressions/mo, 2K-8K clicks, 50-200 leads',
      },
    ],
    allocation: [
      { category: 'Prospecting', percent: 50, description: 'Reach new potential customers with targeted ads' },
      { category: 'Retargeting', percent: 25, description: 'Re-engage website visitors who didn\'t convert' },
      { category: 'Brand Awareness', percent: 15, description: 'Build recognition and trust in your market' },
      { category: 'Local Offers', percent: 10, description: 'Promote special deals to nearby customers' },
    ],
    tips: [
      'Start with a smaller budget, test different audiences for 2-3 weeks, then scale what works.',
      'Allocate at least 10% of budget to creative testing \u2014 try different images, headlines, and CTAs.',
      'Monitor your cost-per-lead (CPL) weekly. If CPL rises above your target, pause underperforming ads.',
      'Use lookalike audiences based on your best customers for highest-quality prospecting.',
      'Schedule ads during peak hours for your audience \u2014 typically 7-9 AM and 6-9 PM local time.',
    ],
  };
}