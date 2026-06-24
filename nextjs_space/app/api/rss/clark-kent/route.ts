export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateContentBriefWithFallback } from '@/lib/rss/trade-area-feed';
import type { ContentBrief } from '@/lib/rss/trade-area-feed';
import { getUpcomingEvents, type UpcomingEvent } from '@/lib/social/upcoming-events';
import {
  generateInterestFeedBrief,
  formatInterestBriefForCommand,
  type InterestFeedBrief,
} from '@/lib/rss/interest-feed-brief';

/**
 * Clark Kent — Social Scout (Local + Interest Intelligence)
 *
 * POST /api/rss/clark-kent
 * Body: { businessId?, analysisId?, zip?, radius? }
 *
 * Gathers intelligence that Jim Bridger does NOT have:
 *   1. RSS local news from the business's trade area (if mode includes local)
 *   2. National/interest-category feeds from selected categories (if mode includes interests)
 *   3. Upcoming holidays & events from the calendar
 *   4. Geographic context (ZIP, city, state, radius)
 *
 * Content source is driven by Business.contentSourceMode:
 *   - "local_only"           → only local trade-area RSS + events
 *   - "local_plus_interests" → local RSS + selected interest feeds + events
 *   - "interests_only"       → interest feeds + events (no local ZIP required)
 *
 * Does NOT gather business/website intel — that's Jim Bridger's job.
 */

export type ContentSourceMode = 'local_only' | 'local_plus_interests' | 'interests_only';

export interface ScoutBrief {
  generatedAt: string;
  contentSourceMode: ContentSourceMode;
  tradeArea: {
    zip: string;
    city: string;
    state: string;
    radiusMiles: number;
  };
  rssBrief: ContentBrief | null;
  interestBrief: InterestFeedBrief | null;
  upcomingEvents: UpcomingEvent[];
  scoutSummary: string; // Human-readable briefing for Tombstone command
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const body = await req.json();
    const { businessId, analysisId, zip: directZip, radius = 25, contentSourceMode: modeOverride, _internalUserId } = body;

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

    // ── Resolve business + contentSourceMode ──────────────────────────
    let resolvedBusinessId = businessId || null;
    let contentSourceMode: ContentSourceMode = 'local_plus_interests';

    if (resolvedBusinessId) {
      const biz = await prisma.business.findUnique({
        where: { id: resolvedBusinessId },
        select: { id: true, contentSourceMode: true, userId: true },
      });
      if (biz && biz.userId === userId) {
        contentSourceMode = (biz.contentSourceMode || 'local_plus_interests') as ContentSourceMode;
      }
    } else {
      // Fallback: find most recently updated business for this user
      const biz = await prisma.business.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, contentSourceMode: true },
      });
      if (biz) {
        resolvedBusinessId = biz.id;
        contentSourceMode = (biz.contentSourceMode || 'local_plus_interests') as ContentSourceMode;
      }
    }

    // Allow per-request mode override from the frontend
    const validModes: ContentSourceMode[] = ['local_only', 'local_plus_interests', 'interests_only'];
    if (modeOverride && validModes.includes(modeOverride)) {
      contentSourceMode = modeOverride;
    }

    const includeLocal = contentSourceMode !== 'interests_only';
    const includeInterests = contentSourceMode !== 'local_only';

    console.log(`[Clark Kent] mode=${contentSourceMode} businessId=${resolvedBusinessId || 'none'} includeLocal=${includeLocal} includeInterests=${includeInterests}`);

    // ── Resolve geographic context (ZIP, city, state) ────────────────
    let businessZip: string | null = directZip || null;
    let businessCity: string | null = null;
    let businessState: string | null = null;

    if (includeLocal) {
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
    }

    // ── Gather local RSS intelligence (if mode includes local) ────────
    let rssBrief: ContentBrief | null = null;
    if (includeLocal && businessZip) {
      try {
        rssBrief = await generateContentBriefWithFallback(
          businessZip,
          radius,
          { city: businessCity, state: businessState },
          { days: 5, limit: 30 },
        );
        if (rssBrief.summary.totalItems === 0) rssBrief = null;
      } catch (err) {
        console.error('[Clark Kent] RSS brief error:', err);
      }
    } else if (includeLocal) {
      console.log('[Clark Kent] No ZIP available — skipping local RSS');
    }

    // ── Gather interest/national feed brief (if mode includes interests) ─
    let interestBrief: InterestFeedBrief | null = null;
    if (includeInterests && resolvedBusinessId) {
      try {
        console.log(`[Clark Kent] Calling generateInterestFeedBrief for business=${resolvedBusinessId}`);
        interestBrief = await generateInterestFeedBrief(resolvedBusinessId, { days: 5 });
        console.log(`[Clark Kent] Interest brief result: totalItems=${interestBrief.summary.totalItems}, categories=${interestBrief.summary.totalCategories}, feeds=${interestBrief.summary.feedsMatched}`);
        if (interestBrief.summary.totalItems === 0) {
          console.log('[Clark Kent] Interest brief returned 0 items — setting to null');
          interestBrief = null;
        }
      } catch (err: any) {
        console.error('[Clark Kent] Interest feed brief error:', err?.message || err);
        console.error('[Clark Kent] Interest feed stack:', err?.stack);
      }
    } else {
      console.log(`[Clark Kent] Skipping interest feeds — includeInterests=${includeInterests}, resolvedBusinessId=${resolvedBusinessId || 'NONE'}`);
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
    const scoutSummary = buildScoutSummary(contentSourceMode, tradeArea, rssBrief, interestBrief, upcomingEvents);

    const brief: ScoutBrief = {
      generatedAt: new Date().toISOString(),
      contentSourceMode,
      tradeArea,
      rssBrief,
      interestBrief,
      upcomingEvents: upcomingEvents.slice(0, 8),
      scoutSummary,
    };

    console.log(`[Clark Kent] Scout brief generated in ${Date.now() - start}ms — ` +
      `mode=${contentSourceMode}, ` +
      `localRSS: ${rssBrief?.summary.totalItems ?? 0} items, ` +
      `interestRSS: ${interestBrief?.summary.totalItems ?? 0} items (${interestBrief?.summary.totalCategories ?? 0} cats), ` +
      `Events: ${upcomingEvents.length}, ` +
      `Trade area: ${tradeArea.city}, ${tradeArea.state} ${tradeArea.zip}`);

    return NextResponse.json({
      brief,
      meta: {
        contentSourceMode,
        businessId: resolvedBusinessId,
        hasLocation: !!(businessZip || businessCity),
        zip: tradeArea.zip,
        city: tradeArea.city,
        state: tradeArea.state,
        radiusMiles: radius,
        queryTimeMs: Date.now() - start,
        rssItemCount: rssBrief?.summary.totalItems ?? 0,
        rssDiagnostics: rssBrief?.diagnostics ?? null,
        interestItemCount: interestBrief?.summary.totalItems ?? 0,
        interestCategoryCount: interestBrief?.summary.totalCategories ?? 0,
        interestFeedsMatched: interestBrief?.summary.feedsMatched ?? 0,
        eventCount: upcomingEvents.length,
        includeLocal,
        includeInterests,
      },
    });
  } catch (error: any) {
    console.error('Clark Kent scout error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Build scout summary — adapts structure based on contentSourceMode.
// Jim Bridger handles all website/business reconnaissance.
// ══════════════════════════════════════════════════════════════════════════════

function buildScoutSummary(
  mode: ContentSourceMode,
  tradeArea: ScoutBrief['tradeArea'],
  rssBrief: ContentBrief | null,
  interestBrief: InterestFeedBrief | null,
  events: UpcomingEvent[],
): string {
  const lines: string[] = [];

  lines.push(`CONTENT SOURCE MODE: ${mode}`);
  lines.push('');

  // Geographic context (always included if available)
  if (tradeArea.zip || tradeArea.city) {
    lines.push(`TRADE AREA: ${tradeArea.city}${tradeArea.state ? ', ' + tradeArea.state : ''} ${tradeArea.zip} (${tradeArea.radiusMiles}mi radius)`);
  } else {
    lines.push('TRADE AREA: Not available (interest-only mode or no ZIP on file)');
  }

  // Local RSS headlines (local_only or local_plus_interests)
  if (mode !== 'interests_only') {
    if (rssBrief && rssBrief.headlines.length > 0) {
      lines.push('');
      const fallbackNote = rssBrief.diagnostics?.fallbackLevel && rssBrief.diagnostics.fallbackLevel !== 'zip_radius'
        ? ` [geo fallback: ${rssBrief.diagnostics.fallbackLevel}]` : '';
      lines.push(`LOCAL NEWS (${rssBrief.summary.totalItems} items from ${rssBrief.summary.feedsMatched} feeds)${fallbackNote}:`);
      for (const h of rssBrief.headlines.slice(0, 12)) {
        const level = h.localityLevel ? ` [${h.localityLevel}]` : '';
        lines.push(`  • [${h.sourceType}] "${h.title}" — ${h.source} (${h.pubDate?.split('T')[0] || 'recent'})${level}`);
      }
      if (rssBrief.summary.topCategories.length > 0) {
        lines.push('');
        lines.push('SOURCE TYPES: ' + rssBrief.summary.topCategories.map(c => `${c.type}(${c.count})`).join(', '));
      }
      if (rssBrief.patterns.length > 0) {
        lines.push('');
        lines.push('PATTERNS DETECTED:');
        for (const p of rssBrief.patterns) {
          lines.push(`  • ${p.type}: ${p.description}`);
        }
      }
    } else {
      lines.push('');
      lines.push('LOCAL NEWS: No local, regional, or national RSS items found after searching all geographic levels (ZIP, city, county, state, national). Feed discovery has been triggered for this location.');
    }
  }

  // Interest/national feed headlines (local_plus_interests or interests_only)
  if (mode !== 'local_only') {
    lines.push('');
    if (interestBrief) {
      lines.push(formatInterestBriefForCommand(interestBrief));
    } else {
      lines.push('INTEREST FEEDS: No interest-category items available.');
    }
  }

  // Upcoming events (always included)
  if (events.length > 0) {
    lines.push('');
    lines.push('UPCOMING EVENTS (next 90 days):');
    for (const e of events.slice(0, 6)) {
      lines.push(`  • ${e.name} (${e.date}) — Ideas: ${e.ideas}`);
    }
  }

  return lines.join('\n');
}
