export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';
import type { ContentBrief } from '@/lib/rss/trade-area-feed';
import { getUpcomingEvents, type UpcomingEvent } from '@/lib/social/upcoming-events';

/**
 * Clark Kent — Social Scout (Intelligence Gathering ONLY)
 *
 * POST /api/rss/clark-kent
 * Body: { analysisId?, zip?, radius? }
 *
 * Gathers local intelligence and returns a structured scout brief.
 * Does NOT generate social posts — that's Tombstone's creative workflow
 * (Zig Ziglar → Ogilvy → Don Draper → Andy Warhol → Claude Hopkins).
 *
 * Returns:
 *   - rssBrief: ContentBrief from trade area RSS feeds
 *   - upcomingEvents: Holidays/events in the next 90 days
 *   - businessContext: Name, URL, location, industry, value props
 *   - scoutSummary: Human-readable briefing text for Tombstone agents
 */

export interface ScoutBrief {
  generatedAt: string;
  businessContext: {
    businessName: string;
    websiteUrl: string;
    businessCity: string;
    businessState: string;
    businessZip: string;
    industry: string;
    coreOffer: string;
    targetCustomer: string;
    valuePropositions: string[];
  };
  rssBrief: ContentBrief | null;
  upcomingEvents: UpcomingEvent[];
  scoutSummary: string; // Human-readable briefing for Tombstone command
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const body = await req.json();
    const { analysisId, zip: directZip, radius = 25, _internalUserId } = body;

    // Auth: allow internal server-to-server calls with _internalUserId
    let userId: string;
    if (_internalUserId) {
      userId = _internalUserId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = (session.user as any).id;
    }

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

    // ── Extract business intel from analysis results ───────────────────
    const bizSummary = analysisResults?.research?.business_summary || {};
    const industry = bizSummary.industry || bizSummary.category || '';
    const coreOffer = bizSummary.core_offer || bizSummary.services || '';
    const targetCustomer = bizSummary.target_customer || bizSummary.audience || '';
    const rawValueProps = bizSummary.value_propositions || bizSummary.differentiators || [];
    const valuePropositions = Array.isArray(rawValueProps) ? rawValueProps : [rawValueProps].filter(Boolean);

    // ── Gather RSS intelligence ────────────────────────────────────────
    let rssBrief: ContentBrief | null = null;
    try {
      rssBrief = await generateContentBrief(businessZip, radius, { days: 5, limit: 30 });
      if (rssBrief.summary.totalItems === 0) rssBrief = null;
    } catch (err) {
      console.error('[Clark Kent] RSS brief error:', err);
    }

    // ── Gather upcoming events ─────────────────────────────────────────
    const upcomingEvents = getUpcomingEvents();

    // ── Build business context ─────────────────────────────────────────
    const businessContext = {
      businessName: businessName || 'Local Business',
      websiteUrl: websiteUrl || '',
      businessCity: businessCity || '',
      businessState: businessState || '',
      businessZip: businessZip!,
      industry,
      coreOffer,
      targetCustomer,
      valuePropositions,
    };

    // ── Build human-readable scout summary for Tombstone ───────────────
    const scoutSummary = buildScoutSummary(businessContext, rssBrief, upcomingEvents);

    const brief: ScoutBrief = {
      generatedAt: new Date().toISOString(),
      businessContext,
      rssBrief,
      upcomingEvents: upcomingEvents.slice(0, 8),
      scoutSummary,
    };

    console.log(`[Clark Kent] Scout brief generated in ${Date.now() - start}ms — ` +
      `RSS: ${rssBrief?.summary.totalItems ?? 0} items, ` +
      `Events: ${upcomingEvents.length}, ` +
      `Business: ${businessContext.businessName}`);

    return NextResponse.json({
      brief,
      meta: {
        businessZip,
        businessName,
        radiusMiles: radius,
        queryTimeMs: Date.now() - start,
        rssItemCount: rssBrief?.summary.totalItems ?? 0,
        eventCount: upcomingEvents.length,
      },
    });
  } catch (error: any) {
    console.error('Clark Kent scout error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Build a concise human-readable briefing that gets embedded in the Tombstone
// command so Zig Ziglar (and downstream agents) have local context.
// ══════════════════════════════════════════════════════════════════════════════

function buildScoutSummary(
  biz: ScoutBrief['businessContext'],
  rssBrief: ContentBrief | null,
  events: UpcomingEvent[],
): string {
  const lines: string[] = [];

  lines.push(`BUSINESS: ${biz.businessName} (${biz.websiteUrl || 'local business'})`);
  lines.push(`LOCATION: ${biz.businessCity}, ${biz.businessState} ${biz.businessZip}`);
  if (biz.industry) lines.push(`INDUSTRY: ${biz.industry}`);
  if (biz.coreOffer) lines.push(`CORE OFFER: ${biz.coreOffer}`);
  if (biz.targetCustomer) lines.push(`TARGET CUSTOMER: ${biz.targetCustomer}`);
  if (biz.valuePropositions.length > 0) {
    lines.push(`VALUE PROPS: ${biz.valuePropositions.join('; ')}`);
  }

  // RSS headlines
  if (rssBrief && rssBrief.headlines.length > 0) {
    lines.push('');
    lines.push(`LOCAL NEWS (${rssBrief.summary.totalItems} items from ${rssBrief.summary.feedsMatched} feeds, ${rssBrief.radiusMiles}mi radius):`);
    for (const h of rssBrief.headlines.slice(0, 12)) {
      lines.push(`  • [${h.sourceType}] "${h.title}" — ${h.source} (${h.pubDate?.split('T')[0] || 'recent'})`);
    }
    // Patterns
    if (rssBrief.patterns.length > 0) {
      lines.push('PATTERNS:');
      for (const p of rssBrief.patterns) {
        lines.push(`  • ${p.type}: ${p.description}`);
      }
    }
  } else {
    lines.push('');
    lines.push('LOCAL NEWS: No RSS items found in trade area.');
  }

  // Upcoming events
  if (events.length > 0) {
    lines.push('');
    lines.push('UPCOMING EVENTS (next 90 days):');
    for (const e of events.slice(0, 6)) {
      lines.push(`  • ${e.name} (${e.date}) — Ideas: ${e.ideas}`);
    }
  }

  return lines.join('\n');
}
