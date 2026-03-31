export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getMultiWorkflowStatus, getWorkflowResults } from '@/lib/tombstone';
import { runSeoAudit } from '@/lib/seo-audit';

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

    // If already completed with ads, return cached results
    if (analysis.status === 'completed' && (analysis.ads?.length ?? 0) > 0) {
      return NextResponse.json({
        status: 'completed',
        ads: analysis.ads ?? [],
        seoData: analysis.seoData ?? null,
        postingPlan: analysis.postingPlan ?? null,
        tasks: [], // No need to poll tasks anymore
      });
    }

    if (!analysis.missionId) {
      return NextResponse.json({ status: analysis.status, error: 'No mission ID', tasks: [] });
    }

    // Parse workflow IDs (comma-separated)
    const workflowIds = analysis.missionId.split(',').filter(Boolean);

    // Poll Tombstone for status
    const statusResult = await getMultiWorkflowStatus(workflowIds);
    const overallStatus = statusResult?.status ?? 'processing';

    console.log(`[mission-status] analysisId=${analysisId} workflows=${workflowIds.length} overallStatus=${overallStatus} tasks=${statusResult.tasks?.length ?? 0}`);

    if (overallStatus === 'completed') {
      // Fetch full results
      const results = await getWorkflowResults(workflowIds);

      // Build SEO data from research output + live audit
      const seoData = await buildSeoData(results.research, results.creative, analysis.websiteUrl);
      const postingPlan = buildPostingPlan(results.research, results.creative);

      // Create ad records in DB
      for (const ad of results.ads) {
        await prisma.ad.create({
          data: {
            analysisId: analysis.id,
            imageUrl: ad?.imageUrl ?? null,
            caption: ad?.caption ?? '',
            headline: ad?.headline ?? 'Ad',
            watermarked: true,
          },
        });
      }

      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          results: results as any,
          seoData: seoData as any,
          postingPlan: postingPlan as any,
        },
      });

      const updatedAnalysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        include: { ads: true },
      });

      return NextResponse.json({
        status: 'completed',
        ads: updatedAnalysis?.ads ?? [],
        seoData,
        postingPlan,
        tasks: statusResult.tasks ?? [],
      });
    }

    // Update status in DB if changed
    const mappedStatus = overallStatus === 'error' ? 'error' : overallStatus === 'generating' ? 'generating' : 'processing';
    if (analysis.status !== mappedStatus) {
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
          errorReason = 'Ad generation encountered an issue. Please try again.';
        }
        console.log(`[mission-status] Error reason: ${raw}`);
      }
    }

    return NextResponse.json({
      status: mappedStatus,
      tasks: statusResult.tasks ?? [],
      ...(errorReason ? { errorReason } : {}),
    });
  } catch (err: any) {
    console.error('Mission status error:', err);
    return NextResponse.json({ error: 'Failed to check status', tasks: [] }, { status: 500 });
  }
}

/**
 * Build SEO data from research output + live website audit.
 */
async function buildSeoData(research: any, creative: any, websiteUrl: string) {
  // Run live SEO audit against the website
  let audit = null;
  try {
    audit = await runSeoAudit(websiteUrl);
    console.log(`[seo-audit] ${websiteUrl}: score=${audit.score} grade=${audit.grade}`);
  } catch (err: any) {
    console.error('[seo-audit] Error:', err?.message);
  }

  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const constraints = research?.messaging_constraints ?? {};

  return {
    businessName: biz?.name ?? 'Unknown',
    industry: biz?.category ?? 'Unknown',
    coreOffer: biz?.core_offer ?? '',
    targetCustomer: biz?.target_customer ?? '',
    products: biz?.products ?? [],
    geo: biz?.geo ?? '',
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
function buildPostingPlan(research: any, creative: any) {
  if (!research) return null;
  const biz = research?.business_summary ?? {};
  const topics = research?.messaging_constraints?.allowed_topics ?? [];
  const businessName = biz?.name ?? 'Your Business';
  const coreOffer = biz?.core_offer ?? 'your products/services';
  const targetCustomer = biz?.target_customer ?? 'your target audience';

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