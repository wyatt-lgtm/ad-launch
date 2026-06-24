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
    // Business-scoped geo fields — populated from the canonical business record
    let bizGeoCity: string | null = null;
    let bizGeoState: string | null = null;
    let bizGeoZip: string | null = null;
    let bizGeoName: string | null = null;

    if (resolvedBusinessId) {
      const biz = await prisma.business.findUnique({
        where: { id: resolvedBusinessId },
        select: { id: true, contentSourceMode: true, userId: true, businessName: true, businessCity: true, businessState: true, businessZip: true },
      });
      if (biz && biz.userId === userId) {
        contentSourceMode = (biz.contentSourceMode || 'local_plus_interests') as ContentSourceMode;
        bizGeoCity = biz.businessCity;
        bizGeoState = biz.businessState;
        bizGeoZip = biz.businessZip;
        bizGeoName = biz.businessName;
      }
    } else {
      // Fallback: find most recently updated business for this user
      const biz = await prisma.business.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, contentSourceMode: true, businessName: true, businessCity: true, businessState: true, businessZip: true },
      });
      if (biz) {
        resolvedBusinessId = biz.id;
        contentSourceMode = (biz.contentSourceMode || 'local_plus_interests') as ContentSourceMode;
        bizGeoCity = biz.businessCity;
        bizGeoState = biz.businessState;
        bizGeoZip = biz.businessZip;
        bizGeoName = biz.businessName;
      }
    }

    // Allow per-request mode override from the frontend
    const validModes: ContentSourceMode[] = ['local_only', 'local_plus_interests', 'interests_only'];
    if (modeOverride && validModes.includes(modeOverride)) {
      contentSourceMode = modeOverride;
    }

    const includeLocal = contentSourceMode !== 'interests_only';
    const includeInterests = contentSourceMode !== 'local_only';

    console.log(`[Clark Kent] mode=${contentSourceMode} businessId=${resolvedBusinessId || 'none'} bizName=${bizGeoName || 'none'} includeLocal=${includeLocal} includeInterests=${includeInterests}`);
    console.log(`[Clark Kent] business_geo city=${bizGeoCity || 'none'} state=${bizGeoState || 'none'} zip=${bizGeoZip || 'none'}`);
    console.log(`[ScoutTrace] route_hit=true contentSourceMode=${contentSourceMode} includeLocal=${includeLocal} includeInterests=${includeInterests} resolvedBusinessId=${resolvedBusinessId || 'NONE'}`);

    // ── Resolve geographic context (ZIP, city, state) ────────────────
    // Priority: 1) direct ZIP param, 2) business record geo, 3) business-scoped analysis, 4) analysisId param
    // CRITICAL: geo resolution is BUSINESS-scoped, not user-scoped, to prevent cross-business contamination
    let businessZip: string | null = directZip || null;
    let businessCity: string | null = null;
    let businessState: string | null = null;

    if (includeLocal) {
      // Step 1: Use the canonical business record's geo fields (populated during business setup)
      if (bizGeoZip) {
        businessZip = bizGeoZip;
        businessCity = bizGeoCity;
        businessState = bizGeoState;
        console.log(`[Clark Kent] geo from business record: city=${businessCity} state=${businessState} zip=${businessZip}`);
      }

      // Step 2: If business record has no ZIP, check analysis for THIS specific business
      if (!businessZip && resolvedBusinessId) {
        const bizAnalysis = await prisma.analysis.findFirst({
          where: {
            businessId: resolvedBusinessId,
            businessZip: { not: null },
            geoConfirmed: true,
          },
          orderBy: { createdAt: 'desc' },
          select: { businessZip: true, businessCity: true, businessState: true },
        });
        if (bizAnalysis?.businessZip) {
          businessZip = bizAnalysis.businessZip;
          businessCity = bizAnalysis.businessCity;
          businessState = bizAnalysis.businessState;
          console.log(`[Clark Kent] geo from business-scoped analysis: city=${businessCity} state=${businessState} zip=${businessZip}`);
        }
      }

      // Step 3: If an explicit analysisId was provided, use it as override
      if (!businessZip && analysisId) {
        const analysis = await prisma.analysis.findUnique({
          where: { id: analysisId },
          select: { businessZip: true, businessCity: true, businessState: true },
        });
        if (analysis?.businessZip) {
          businessZip = analysis.businessZip;
          businessCity = analysis.businessCity;
          businessState = analysis.businessState;
          console.log(`[Clark Kent] geo from explicit analysisId: city=${businessCity} state=${businessState} zip=${businessZip}`);
        }
      }

      // Step 4: Use business city/state even without ZIP (for city-level fallback)
      if (!businessZip && !businessCity && bizGeoCity) {
        businessCity = bizGeoCity;
        businessState = bizGeoState;
        console.log(`[Clark Kent] geo city/state from business record (no ZIP): city=${businessCity} state=${businessState}`);
      }

      console.log(`[Clark Kent] final resolved geo: city=${businessCity || 'none'} state=${businessState || 'none'} zip=${businessZip || 'none'}`);
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
          { excludeNational: contentSourceMode === 'local_only' },
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
    let interestQueryCalled = false;
    let interestSkipReason: string | null = null;
    let interestQueryError: string | null = null;
    if (includeInterests && resolvedBusinessId) {
      try {
        interestQueryCalled = true;
        console.log(`[Clark Kent] Calling generateInterestFeedBrief for business=${resolvedBusinessId}`);
        console.log(`[ScoutTrace] interestQueryCalled=true businessId=${resolvedBusinessId}`);
        interestBrief = await generateInterestFeedBrief(resolvedBusinessId, { days: 5 });
        console.log(`[Clark Kent] Interest brief result: totalItems=${interestBrief.summary.totalItems}, categories=${interestBrief.summary.totalCategories}, feeds=${interestBrief.summary.feedsMatched}`);
        console.log(`[ScoutTrace] interestQueryResultCount=${interestBrief.summary.totalItems} categories=${interestBrief.summary.totalCategories} feeds=${interestBrief.summary.feedsMatched}`);
        if (interestBrief.categories?.length > 0) {
          console.log(`[ScoutTrace] interestCategories=${JSON.stringify(interestBrief.categories.map(c => ({ industry: c.industry, label: c.label, items: c.itemCount })))}`);
        }
        if (interestBrief.summary.totalItems === 0) {
          console.log('[Clark Kent] Interest brief returned 0 items — setting to null');
          interestSkipReason = 'zero_items_returned';
          interestBrief = null;
        }
      } catch (err: any) {
        console.error('[Clark Kent] Interest feed brief error:', err?.message || err);
        console.error('[Clark Kent] Interest feed stack:', err?.stack);
        interestQueryError = err?.message || String(err);
        interestSkipReason = 'query_error';
      }
    } else {
      interestSkipReason = !includeInterests ? 'mode_excludes_interests' : 'no_business_id';
      console.log(`[Clark Kent] Skipping interest feeds — includeInterests=${includeInterests}, resolvedBusinessId=${resolvedBusinessId || 'NONE'}, reason=${interestSkipReason}`);
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

    console.log(`[ScoutTrace] industryStoriesInBrief=${brief.interestBrief?.categories?.length ?? 0} upcomingEventsInBrief=${brief.upcomingEvents?.length ?? 0} localStoriesInBrief=${brief.rssBrief?.summary?.totalItems ?? 0}`);
    console.log(`[ScoutTrace] responseKeys=${Object.keys(brief).join(',')} interestBriefIsNull=${brief.interestBrief === null}`);

    return NextResponse.json({
      brief,
      meta: {
        contentSourceMode,
        businessId: resolvedBusinessId,
        businessName: bizGeoName || null,
        hasLocation: !!(businessZip || businessCity),
        zip: tradeArea.zip,
        city: tradeArea.city,
        state: tradeArea.state,
        radiusMiles: radius,
        queryTimeMs: Date.now() - start,
        rssItemCount: rssBrief?.summary.totalItems ?? 0,
        rssDiagnostics: rssBrief?.diagnostics ?? null,
        localFeedDiagnostics: {
          resolvedGeo: {
            zip: businessZip,
            city: businessCity,
            state: businessState,
            countyFips: rssBrief?.diagnostics?.countyFips ?? null,
            stateFips: rssBrief?.diagnostics?.stateFips ?? null,
            geoSource: bizGeoZip ? 'business_record' : 'analysis_fallback',
            geoResolutionMethod: rssBrief?.diagnostics?.geoResolutionMethod ?? 'none',
          },
          cascadeLevels: rssBrief?.diagnostics?.levelsAttempted ?? [],
          fallbackLevel: rssBrief?.diagnostics?.fallbackLevel ?? 'not_attempted',
          discoveryTriggered: rssBrief?.diagnostics?.discoveryTriggered ?? false,
          discoveryReason: rssBrief?.diagnostics?.discoveryReason ?? null,
          totalFeedsChecked: rssBrief?.diagnostics?.totalFeedsChecked ?? 0,
          totalItemsFetched: rssBrief?.diagnostics?.totalItemsFetched ?? 0,
          finalItemCount: rssBrief?.diagnostics?.finalItemCount ?? 0,
          rejectedItems: rssBrief?.diagnostics?.rejectedItems ?? [],
        },
        interestItemCount: interestBrief?.summary.totalItems ?? 0,
        interestCategoryCount: interestBrief?.summary.totalCategories ?? 0,
        interestFeedsMatched: interestBrief?.summary.feedsMatched ?? 0,
        interestQueryCalled,
        interestSkipReason,
        interestQueryError,
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
      // Separate local items from any national fallback that made it through
      const localHeadlines = rssBrief.headlines.filter(h => {
        const lvl = h.localityLevel || 'unknown';
        return ['zip', 'zip_radius', 'city', 'county', 'state'].includes(lvl);
      });
      const nationalHeadlines = rssBrief.headlines.filter(h => {
        const lvl = h.localityLevel || 'unknown';
        return !['zip', 'zip_radius', 'city', 'county', 'state'].includes(lvl);
      });

      if (localHeadlines.length > 0) {
        lines.push(`LOCAL NEWS (${localHeadlines.length} items from local/regional feeds)${fallbackNote}:`);
        for (const h of localHeadlines.slice(0, 12)) {
          const level = h.localityLevel ? ` [${h.localityLevel}]` : '';
          lines.push(`  \u2022 [${h.sourceType}] "${h.title}" \u2014 ${h.source} (${h.pubDate?.split('T')[0] || 'recent'})${level}`);
        }
      }
      if (nationalHeadlines.length > 0) {
        lines.push('');
        lines.push(`NATIONAL FALLBACK (${nationalHeadlines.length} items — not truly local):`);
        for (const h of nationalHeadlines.slice(0, 6)) {
          lines.push(`  \u2022 [${h.sourceType}] "${h.title}" \u2014 ${h.source} (${h.pubDate?.split('T')[0] || 'recent'}) [national]`);
        }
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
