export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';
import type { ContentBrief } from '@/lib/rss/trade-area-feed';
import { getUpcomingEvents, type UpcomingEvent } from '@/lib/social/upcoming-events';

/**
 * Clark Kent — Social Scout (Local Intelligence ONLY)
 *
 * POST /api/rss/clark-kent
 * Body: { analysisId?, zip?, radius? }
 *
 * Gathers LOCAL intelligence that Jim Bridger does NOT have:
 *   1. RSS local news from the business's trade area
 *   2. Upcoming holidays & events from the calendar
 *   3. Geographic context (ZIP, city, state, radius)
 *
 * Does NOT gather business/website intel — that's Jim Bridger's job.
 * Jim Bridger already provides: business_summary, brand_voice,
 * messaging_constraints, semantic_truth, offers, brand_palette
 * to Zig Ziglar and the creative chain.
 *
 * Clark Kent's output is a supplement to Bridger's recon,
 * giving the creative team LOCAL context they can't get from the website.
 */

export interface ScoutBrief {
  generatedAt: string;
  tradeArea: {
    zip: string;
    city: string;
    state: string;
    radiusMiles: number;
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

    // ── Resolve geographic context (ZIP, city, state) ────────────────
    let businessZip: string | null = directZip || null;
    let businessCity: string | null = null;
    let businessState: string | null = null;

    if (analysisId) {
      const analysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        select: { businessZip: true, businessCity: true, businessState: true },
      });
      if (analysis) {
        businessZip = analysis.businessZip || businessZip;
        businessCity = analysis.businessCity;
        businessState = analysis.businessState;
      }
    }

    if (!businessZip) {
      const recentAnalysis = await prisma.analysis.findFirst({
        where: { userId, businessZip: { not: null }, geoConfirmed: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, businessZip: true, businessCity: true, businessState: true },
      });
      if (recentAnalysis) {
        businessZip = recentAnalysis.businessZip;
        businessCity = recentAnalysis.businessCity;
        businessState = recentAnalysis.businessState;
      }
    }

    // Fallback: look up ZIP from the user's Business records
    if (!businessZip) {
      const bizWithZip = await prisma.business.findFirst({
        where: { userId, businessZip: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { businessZip: true, businessCity: true, businessState: true },
      });
      if (bizWithZip?.businessZip) {
        businessZip = bizWithZip.businessZip;
        businessCity = bizWithZip.businessCity;
        businessState = bizWithZip.businessState;
      }
    }

    // If still no ZIP, proceed with national-only mode (events + national feeds)
    // instead of hard-failing — this supports category-based post generation

    // ── Gather RSS intelligence (requires ZIP for local news) ──────────
    let rssBrief: ContentBrief | null = null;
    if (businessZip) {
      try {
        rssBrief = await generateContentBrief(businessZip, radius, { days: 5, limit: 30 });
        if (rssBrief.summary.totalItems === 0) rssBrief = null;
      } catch (err) {
        console.error('[Clark Kent] RSS brief error:', err);
      }
    } else {
      console.log('[Clark Kent] No ZIP available — skipping local RSS, national/events only');
    }

    // ── Gather upcoming events ─────────────────────────────────────────
    const upcomingEvents = getUpcomingEvents();

    // ── Build trade area context (geographic only) ───────────────────
    const tradeArea = {
      zip: businessZip || '',
      city: businessCity || '',
      state: businessState || '',
      radiusMiles: radius,
    };

    // ── Build human-readable scout summary for Tombstone ───────────────
    const scoutSummary = buildScoutSummary(tradeArea, rssBrief, upcomingEvents);

    const brief: ScoutBrief = {
      generatedAt: new Date().toISOString(),
      tradeArea,
      rssBrief,
      upcomingEvents: upcomingEvents.slice(0, 8),
      scoutSummary,
    };

    console.log(`[Clark Kent] Scout brief generated in ${Date.now() - start}ms — ` +
      `RSS: ${rssBrief?.summary.totalItems ?? 0} items, ` +
      `Events: ${upcomingEvents.length}, ` +
      `Trade area: ${tradeArea.city}, ${tradeArea.state} ${tradeArea.zip}`);

    return NextResponse.json({
      brief,
      meta: {
        zip: tradeArea.zip,
        city: tradeArea.city,
        state: tradeArea.state,
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
// Build scout summary: LOCAL intel only. No business data.
// Jim Bridger handles all website/business reconnaissance.
// ══════════════════════════════════════════════════════════════════════════════

function buildScoutSummary(
  tradeArea: ScoutBrief['tradeArea'],
  rssBrief: ContentBrief | null,
  events: UpcomingEvent[],
): string {
  const lines: string[] = [];

  // Geographic context only
  lines.push(`TRADE AREA: ${tradeArea.city}${tradeArea.state ? ', ' + tradeArea.state : ''} ${tradeArea.zip} (${tradeArea.radiusMiles}mi radius)`);

  // RSS headlines
  if (rssBrief && rssBrief.headlines.length > 0) {
    lines.push('');
    lines.push(`LOCAL NEWS (${rssBrief.summary.totalItems} items from ${rssBrief.summary.feedsMatched} feeds):`);
    for (const h of rssBrief.headlines.slice(0, 12)) {
      lines.push(`  • [${h.sourceType}] "${h.title}" — ${h.source} (${h.pubDate?.split('T')[0] || 'recent'})`);
    }
    // Source type breakdown
    if (rssBrief.summary.topCategories.length > 0) {
      lines.push('');
      lines.push('SOURCE TYPES: ' + rssBrief.summary.topCategories.map(c => `${c.type}(${c.count})`).join(', '));
    }
    // Patterns
    if (rssBrief.patterns.length > 0) {
      lines.push('');
      lines.push('PATTERNS DETECTED:');
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
