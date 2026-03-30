export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getMultiWorkflowStatus, getWorkflowResults } from '@/lib/tombstone';

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

      // Build SEO data from research output
      const seoData = buildSeoData(results.research, results.creative, analysis.websiteUrl);
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

    return NextResponse.json({
      status: mappedStatus,
      tasks: statusResult.tasks ?? [],
    });
  } catch (err: any) {
    console.error('Mission status error:', err);
    return NextResponse.json({ error: 'Failed to check status', tasks: [] }, { status: 500 });
  }
}

/**
 * Build SEO data from research output.
 */
function buildSeoData(research: any, creative: any, websiteUrl: string) {
  if (!research) return null;
  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const constraints = research?.messaging_constraints ?? {};
  const palette = research?.brand_palette ?? {};

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
    brandColors: palette?.colors ?? palette?.primary ? palette : null,
    websiteUrl,
    recommendations: [
      constraints?.allowed_topics?.length > 0
        ? `Focus content around: ${(constraints.allowed_topics as string[]).slice(0, 5).join(', ')}`
        : 'Create content that highlights your unique value proposition',
      biz?.target_customer ? `Target audience: ${biz.target_customer}` : 'Define your target audience clearly',
      biz?.core_offer ? `Lead with your core offer: ${biz.core_offer}` : 'Clarify your primary offer',
      'Maintain consistent brand voice across all channels',
      'Post 3-5x per week for optimal engagement',
      'Use high-quality real photos over stock imagery',
    ],
  };
}

/**
 * Build a 90-day posting plan from research data.
 */
function buildPostingPlan(research: any, creative: any) {
  if (!research) return null;
  const biz = research?.business_summary ?? {};
  const topics = research?.messaging_constraints?.allowed_topics ?? [];
  const businessName = biz?.name ?? 'Your Business';
  const coreOffer = biz?.core_offer ?? 'your products/services';
  const targetCustomer = biz?.target_customer ?? 'your target audience';

  return {
    businessName,
    overview: `A strategic 90-day social media plan for ${businessName} targeting ${targetCustomer}. This plan builds awareness, drives engagement, and converts followers into customers through a proven content framework.`,
    phases: [
      {
        name: 'Phase 1: Foundation & Awareness',
        weeks: 'Weeks 1-4',
        goal: 'Establish brand presence and build initial audience',
        frequency: '4 posts per week',
        contentMix: [
          { type: 'Brand Story', percent: 30, description: `Introduce ${businessName} — who you are, what you do, and why you do it` },
          { type: 'Value Posts', percent: 40, description: `Educational content about ${coreOffer} that solves problems for ${targetCustomer}` },
          { type: 'Social Proof', percent: 20, description: 'Customer testimonials, reviews, and success stories' },
          { type: 'Behind the Scenes', percent: 10, description: 'Team photos, process videos, day-in-the-life content' },
        ],
        weeklySchedule: [
          { day: 'Monday', type: 'Value Post', example: topics[0] ? `Tip: ${topics[0]}` : 'Educational tip related to your industry' },
          { day: 'Wednesday', type: 'Brand Story', example: `Why ${businessName} exists and the problem we solve` },
          { day: 'Friday', type: 'Social Proof', example: 'Customer spotlight or testimonial' },
          { day: 'Saturday', type: 'Engagement', example: 'Poll, question, or community-building post' },
        ],
      },
      {
        name: 'Phase 2: Engagement & Authority',
        weeks: 'Weeks 5-8',
        goal: 'Deepen relationships and establish expertise',
        frequency: '5 posts per week',
        contentMix: [
          { type: 'Educational Content', percent: 35, description: `Deep dives on ${coreOffer} — how-tos, guides, comparisons` },
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
    ctaMessage: `Ready to execute this plan? Our team can manage your entire social media presence — content creation, scheduling, community management, and performance reporting — so you can focus on running ${businessName}.`,
  };
}
