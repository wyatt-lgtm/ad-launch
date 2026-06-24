// @ts-nocheck
/**
 * Phase 6B: Trade Area Feed Query Engine
 *
 * The unified "give me safe, fresh items for this business" function.
 * This is Clark Kent's primary entry point.
 *
 * Pipeline:
 *   1. Business ZIP → expand to trade area ZIPs (radius or county)
 *   2. Join FeedGeo → RssFeed (active only) → RssItem (approved only)
 *   3. Rank by freshness, source quality, content type diversity
 *   4. Return a structured content brief payload
 */
import { prisma } from '@/lib/db';
import { rssPrisma } from '@/lib/rss-db';
import { getZipsByRadius, getZipsByCounty, getZipsByCity, getZipDetails } from './geo-lookup';
import type { TradeAreaRequest, TradeAreaItem, TradeAreaResponse } from './types';
import { discoverValidateAndLink, type DiscoveryResult } from './geo-linker';

// Source quality scoring
const QUALITY_SCORES: Record<string, number> = {
  official: 100,
  trusted: 80,
  community: 60,
  aggregator: 40,
  unverified: 20,
};

// Source type diversity bonus — prefer mixing different types
const SOURCE_TYPE_PRIORITY: Record<string, number> = {
  local_news: 10,
  community: 8,
  gov_meeting: 7,
  event: 9,
  weather: 5,
  school: 6,
  lifestyle: 7,
  police_blotter: 3,
  sports_local: 6,
  church: 4,
  library: 5,
  parks_rec: 5,
  chamber_of_commerce: 7,
  real_estate: 4,
  local_business: 8,
  unknown: 2,
};

// ── Main Query ──────────────────────────────────────────────────────────────

export async function getTradeAreaItems(
  request: TradeAreaRequest
): Promise<TradeAreaResponse> {
  const start = Date.now();
  const {
    zips: directZips,
    cities,
    counties,
    states,
    limit = 30,
    days = 7,
    sourceTypes,
    minConfidence = 0.3,
    excludeInferred = false,
    excludeUsed = false,
  } = request;

  // ── Step 1: Resolve all ZIP IDs in the trade area ─────────────────────
  const zipIdSet = new Set<string>();
  const zipCodeSet = new Set<string>();

  // Direct ZIPs
  if (directZips?.length) {
    const zipRows = await prisma.geoZip.findMany({
      where: { code: { in: directZips } },
      select: { id: true, code: true },
    });
    for (const z of zipRows) {
      zipIdSet.add(z.id);
      zipCodeSet.add(z.code);
    }
  }

  // City-based (expand each city to its ZIPs)
  if (cities?.length) {
    for (const citySpec of cities) {
      // Format: "City, ST" or just "City"
      const parts = citySpec.split(',').map(s => s.trim());
      const cityName = parts[0];
      const stateCode = parts[1]?.toUpperCase();
      if (cityName && stateCode) {
        const result = await getZipsByCity(cityName, stateCode);
        for (const z of result.zips) {
          zipIdSet.add(z.id);
          zipCodeSet.add(z.code);
        }
      }
    }
  }

  // County-based
  if (counties?.length) {
    for (const countySpec of counties) {
      const parts = countySpec.split(',').map(s => s.trim());
      const countyName = parts[0];
      const stateCode = parts[1]?.toUpperCase();
      if (countyName && stateCode) {
        const result = await getZipsByCounty(countyName, stateCode);
        for (const z of result.zips) {
          zipIdSet.add(z.id);
          zipCodeSet.add(z.code);
        }
      }
    }
  }

  // State-based (use sparingly — massive result sets)
  if (states?.length) {
    const stateZips = await prisma.geoZip.findMany({
      where: {
        cityZips: {
          some: {
            city: { county: { state: { code: { in: states.map(s => s.toUpperCase()) } } } },
          },
        },
      },
      select: { id: true, code: true },
    });
    for (const z of stateZips) {
      zipIdSet.add(z.id);
      zipCodeSet.add(z.code);
    }
  }

  const zipIds = Array.from(zipIdSet);
  if (zipIds.length === 0) {
    return {
      items: [],
      meta: { totalItems: 0, feedsMatched: 0, zipsSearched: 0, queryTimeMs: Date.now() - start },
    };
  }

  // ── Step 2: Find feeds that cover this trade area ─────────────────────
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Build FeedGeo filter
  const feedGeoWhere: any = {
    zipId: { in: zipIds },
    confidence: { gte: minConfidence },
  };
  if (excludeInferred) {
    feedGeoWhere.coverageType = 'confirmed';
  }

  // Get unique feed IDs from FeedGeo
  const feedGeos = await rssPrisma.feedGeo.findMany({
    where: feedGeoWhere,
    select: { feedId: true, confidence: true, coverageType: true },
    distinct: ['feedId'],
  });

  const feedConfidenceMap = new Map<string, { confidence: number; coverageType: string }>();
  for (const fg of feedGeos) {
    const existing = feedConfidenceMap.get(fg.feedId);
    if (!existing || fg.confidence > existing.confidence) {
      feedConfidenceMap.set(fg.feedId, { confidence: fg.confidence, coverageType: fg.coverageType });
    }
  }

  const feedIds = Array.from(feedConfidenceMap.keys());
  if (feedIds.length === 0) {
    return {
      items: [],
      meta: { totalItems: 0, feedsMatched: 0, zipsSearched: zipIds.length, queryTimeMs: Date.now() - start },
    };
  }

  // Also include national-scope and state-scope feeds
  const globalFeeds = await rssPrisma.rssFeed.findMany({
    where: {
      status: 'active',
      OR: [
        { geoScope: 'national' },
        {
          geoScope: { in: ['state', 'weather'] },
          pilotState: states?.length ? { in: states } : undefined,
        },
      ],
    },
    select: { id: true },
  });
  for (const f of globalFeeds) {
    if (!feedConfidenceMap.has(f.id)) {
      feedConfidenceMap.set(f.id, { confidence: 0.5, coverageType: 'inferred' });
      feedIds.push(f.id);
    }
  }

  // ── Step 3: Query items from matching feeds ───────────────────────────
  const itemWhere: any = {
    feedId: { in: feedIds },
    filterStatus: 'approved',
    pubDate: { gte: cutoffDate },
    feed: { status: 'active' },
  };

  if (sourceTypes?.length) {
    itemWhere.feed.sourceType = { in: sourceTypes };
  }
  if (excludeUsed) {
    itemWhere.usedInPost = false;
  }

  const rawItems = await rssPrisma.rssItem.findMany({
    where: itemWhere,
    select: {
      id: true,
      title: true,
      description: true,
      link: true,
      pubDate: true,
      imageUrl: true,
      author: true,
      categories: true,
      feedId: true,
      relevanceScore: true,
      feed: {
        select: {
          title: true,
          sourceType: true,
          sourceQuality: true,
        },
      },
    },
    orderBy: { pubDate: 'desc' },
    take: limit * 3, // over-fetch for ranking/diversity
  });

  // ── Step 4: Score and rank ────────────────────────────────────────────
  const scored = rawItems.map(item => {
    const geoInfo = feedConfidenceMap.get(item.feedId);
    const qualityScore = QUALITY_SCORES[item.feed.sourceQuality] ?? 20;
    const typePriority = SOURCE_TYPE_PRIORITY[item.feed.sourceType] ?? 2;
    const hoursOld = item.pubDate
      ? (Date.now() - item.pubDate.getTime()) / (1000 * 60 * 60)
      : 999;
    const freshnessScore = Math.max(0, 100 - hoursOld * 0.6); // decay ~60% per week
    const geoConfidence = geoInfo?.confidence ?? 0.5;

    const compositeScore =
      freshnessScore * 0.35 +
      qualityScore * 0.25 +
      typePriority * 3 +      // 0-30 range
      geoConfidence * 10 +    // 0-10 range
      (item.relevanceScore ?? 50) * 0.05;

    return {
      item,
      compositeScore,
      geoConfidence,
      coverageType: geoInfo?.coverageType ?? 'inferred',
    };
  });

  // Sort by composite score
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // Diversity filter: don't return more than 3 items from same feed
  const feedCounts = new Map<string, number>();
  const diverse: typeof scored = [];
  for (const s of scored) {
    const count = feedCounts.get(s.item.feedId) ?? 0;
    if (count >= 3) continue;
    feedCounts.set(s.item.feedId, count + 1);
    diverse.push(s);
    if (diverse.length >= limit) break;
  }

  // ── Step 5: Format response ───────────────────────────────────────────
  const items: TradeAreaItem[] = diverse.map(s => ({
    id: s.item.id,
    title: s.item.title ?? '',
    description: s.item.description ?? '',
    link: s.item.link ?? '',
    pubDate: s.item.pubDate?.toISOString() ?? '',
    imageUrl: s.item.imageUrl ?? null,
    author: s.item.author ?? null,
    categories: s.item.categories,
    feedId: s.item.feedId,
    feedTitle: s.item.feed.title ?? '',
    feedSourceType: s.item.feed.sourceType,
    feedSourceQuality: s.item.feed.sourceQuality,
    geoConfidence: s.geoConfidence,
    coverageType: s.coverageType as any,
    relevanceScore: s.item.relevanceScore,
  }));

  const uniqueFeeds = new Set(items.map(i => i.feedId));

  return {
    items,
    meta: {
      totalItems: items.length,
      feedsMatched: uniqueFeeds.size,
      zipsSearched: zipIds.length,
      queryTimeMs: Date.now() - start,
    },
  };
}

// ── Convenience: radius-based query ─────────────────────────────────────────

export async function getItemsByRadius(
  centerZip: string,
  radiusMiles: number = 25,
  options: Omit<TradeAreaRequest, 'zips' | 'cities' | 'counties' | 'states'> = {},
): Promise<TradeAreaResponse> {
  const tradeArea = await getZipsByRadius(centerZip, radiusMiles);
  return getTradeAreaItems({
    zips: tradeArea.zips.map(z => z.code),
    ...options,
  });
}

// ── Content Brief (structured payload for Clark Kent) ───────────────────────

export interface ContentBrief {
  generatedAt: string;
  tradeAreaCenter: string;
  radiusMiles: number;
  summary: {
    totalItems: number;
    feedsMatched: number;
    topCategories: { type: string; count: number }[];
  };
  headlines: {
    id: string;
    title: string;
    source: string;
    sourceType: string;
    pubDate: string;
    link: string;
    geoConfidence: number;
    localityLevel?: string;
  }[];
  patterns: {
    type: string;
    description: string;
    itemIds: string[];
  }[];
  diagnostics?: BriefDiagnostics;
}

export interface BriefDiagnostics {
  fallbackLevel: string;
  levelsAttempted: { level: string; feedsFound: number; itemsFound: number; lookbackDays: number }[];
  discoveryTriggered: boolean;
  discoveryReason?: string;
  discoveryResult?: {
    feedsDiscovered: number;
    feedsSaved: number;
    feedGeoLinksCreated: number;
    feedsSkippedInvalid: number;
  };
  totalFeedsChecked: number;
  totalItemsFetched: number;
  finalItemCount: number;
  queryTimeMs: number;
  requestedLocation: { zip: string | null; city: string | null; county: string | null; state: string | null };
  deduplicatedItems: number;
  rejectedItems: { reason: string; count: number }[];
}

// ── Configurable thresholds ─────────────────────────────────────────────────
const SCOUT_MIN_LOCAL_ITEMS = parseInt(process.env.SCOUT_MIN_LOCAL_ITEMS || '5', 10);
const SCOUT_MAX_LOCAL_ITEMS = parseInt(process.env.SCOUT_MAX_LOCAL_ITEMS || '20', 10);
const SCOUT_LOCAL_NEWS_LOOKBACK_DAYS = parseInt(process.env.SCOUT_LOCAL_NEWS_LOOKBACK_DAYS || '14', 10);

/**
 * Original entry point — delegates to the fallback-aware version.
 */
export async function generateContentBrief(
  centerZip: string,
  radiusMiles: number = 25,
  options: Omit<TradeAreaRequest, 'zips' | 'cities' | 'counties' | 'states'> = {},
): Promise<ContentBrief> {
  return generateContentBriefWithFallback(centerZip, radiusMiles, {}, options);
}

/**
 * Generate a content brief with geographic fallback cascade.
 * Widens from ZIP → City → County → State → national-only until
 * SCOUT_MIN_LOCAL_ITEMS is met or all levels are exhausted.
 *
 * Each level progressively widens the lookback window:
 *   ZIP: initial days → City: days*2 → County: LOOKBACK_DAYS → State: LOOKBACK_DAYS
 */
export async function generateContentBriefWithFallback(
  centerZip: string,
  radiusMiles: number = 25,
  geo: { city?: string | null; county?: string | null; state?: string | null },
  options: Omit<TradeAreaRequest, 'zips' | 'cities' | 'counties' | 'states'> = {},
): Promise<ContentBrief> {
  const start = Date.now();
  const initialDays = options.days ?? 5;
  const limit = options.limit ?? 50;

  const diagnostics: BriefDiagnostics = {
    fallbackLevel: 'none',
    levelsAttempted: [],
    discoveryTriggered: false,
    totalFeedsChecked: 0,
    totalItemsFetched: 0,
    finalItemCount: 0,
    queryTimeMs: 0,
    requestedLocation: { zip: centerZip, city: geo.city || null, county: geo.county || null, state: geo.state || null },
    deduplicatedItems: 0,
    rejectedItems: [],
  };

  const seenItemIds = new Set<string>();
  const seenTitleKeys = new Set<string>();
  const allItems: (TradeAreaItem & { localityLevel: string })[] = [];

  // Resolve the full geo hierarchy from the ZIP if not provided
  let resolvedCity = geo.city?.toUpperCase() || null;
  let resolvedCounty = geo.county?.toUpperCase() || null;
  let resolvedState = geo.state?.toUpperCase() || null;

  if (centerZip && (!resolvedCity || !resolvedCounty || !resolvedState)) {
    try {
      const details = await getZipDetails(centerZip);
      if (details) {
        if (!resolvedCity) resolvedCity = details.primaryCity;
        if (!resolvedCounty) resolvedCounty = details.county;
        if (!resolvedState) resolvedState = details.state;
      }
    } catch (err) {
      console.warn('[trade-area-feed] Could not resolve ZIP details:', err);
    }
  }

  console.log(`[trade-area-feed] Geo cascade: ZIP=${centerZip} City=${resolvedCity} County=${resolvedCounty} State=${resolvedState}`);

  // Helper: normalize title for de-dup (lowercase, strip punctuation, collapse whitespace)
  const normTitle = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);

  // Helper: add items with ID + title de-dup
  const addItems = (items: TradeAreaItem[], level: string) => {
    let added = 0;
    let duped = 0;
    for (const item of items) {
      if (seenItemIds.has(item.id)) { duped++; continue; }
      const tk = normTitle(item.title);
      if (tk.length > 15 && seenTitleKeys.has(tk)) { duped++; continue; }
      // Also de-dup by link URL
      seenItemIds.add(item.id);
      if (tk.length > 15) seenTitleKeys.add(tk);
      allItems.push({ ...item, localityLevel: level });
      added++;
    }
    diagnostics.deduplicatedItems += duped;
    return added;
  };

  // ── Level 1: ZIP radius ─────────────────────────────────────────────────
  if (centerZip) {
    const zipResult = await getItemsByRadius(centerZip, radiusMiles, {
      ...options, limit, days: initialDays,
    });
    diagnostics.levelsAttempted.push({
      level: 'zip_radius', feedsFound: zipResult.meta.feedsMatched,
      itemsFound: zipResult.items.length, lookbackDays: initialDays,
    });
    addItems(zipResult.items, 'zip');
    if (allItems.length >= SCOUT_MIN_LOCAL_ITEMS) diagnostics.fallbackLevel = 'zip_radius';
  }

  // ── Level 2: City (wider lookback) ──────────────────────────────────────
  if (allItems.length < SCOUT_MIN_LOCAL_ITEMS && resolvedCity && resolvedState) {
    const cityDays = Math.min(initialDays * 2, SCOUT_LOCAL_NEWS_LOOKBACK_DAYS);
    const cityResult = await getTradeAreaItems({
      cities: [`${resolvedCity}, ${resolvedState}`],
      ...options, limit, days: cityDays,
    });
    diagnostics.levelsAttempted.push({
      level: 'city', feedsFound: cityResult.meta.feedsMatched,
      itemsFound: cityResult.items.length, lookbackDays: cityDays,
    });
    addItems(cityResult.items, 'city');
    if (allItems.length >= SCOUT_MIN_LOCAL_ITEMS && diagnostics.fallbackLevel === 'none') {
      diagnostics.fallbackLevel = 'city';
    }
  }

  // ── Level 3: County (full lookback) ─────────────────────────────────────
  if (allItems.length < SCOUT_MIN_LOCAL_ITEMS && resolvedCounty && resolvedState) {
    const countyResult = await getTradeAreaItems({
      counties: [`${resolvedCounty}, ${resolvedState}`],
      ...options, limit, days: SCOUT_LOCAL_NEWS_LOOKBACK_DAYS,
    });
    diagnostics.levelsAttempted.push({
      level: 'county', feedsFound: countyResult.meta.feedsMatched,
      itemsFound: countyResult.items.length, lookbackDays: SCOUT_LOCAL_NEWS_LOOKBACK_DAYS,
    });
    addItems(countyResult.items, 'county');
    if (allItems.length >= SCOUT_MIN_LOCAL_ITEMS && diagnostics.fallbackLevel === 'none') {
      diagnostics.fallbackLevel = 'county';
    }
  }

  // ── Level 4: State (full lookback) ──────────────────────────────────────
  if (allItems.length < SCOUT_MIN_LOCAL_ITEMS && resolvedState) {
    const stateResult = await getTradeAreaItems({
      states: [resolvedState],
      ...options, limit, days: SCOUT_LOCAL_NEWS_LOOKBACK_DAYS,
    });
    diagnostics.levelsAttempted.push({
      level: 'state', feedsFound: stateResult.meta.feedsMatched,
      itemsFound: stateResult.items.length, lookbackDays: SCOUT_LOCAL_NEWS_LOOKBACK_DAYS,
    });
    addItems(stateResult.items, 'state');
    if (allItems.length >= SCOUT_MIN_LOCAL_ITEMS && diagnostics.fallbackLevel === 'none') {
      diagnostics.fallbackLevel = 'state';
    }
  }

  // ── Level 5: National-only fallback ─────────────────────────────────────
  if (allItems.length < SCOUT_MIN_LOCAL_ITEMS) {
    const nationalFeeds = await rssPrisma.rssFeed.findMany({
      where: { status: 'active', geoScope: 'national' },
      select: { id: true },
    });
    if (nationalFeeds.length > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - SCOUT_LOCAL_NEWS_LOOKBACK_DAYS);
      const nationalItems = await rssPrisma.rssItem.findMany({
        where: {
          feedId: { in: nationalFeeds.map(f => f.id) },
          filterStatus: 'approved',
          pubDate: { gte: cutoff },
          feed: { status: 'active' },
        },
        select: {
          id: true, title: true, description: true, link: true,
          pubDate: true, imageUrl: true, author: true, categories: true,
          feedId: true, relevanceScore: true,
          feed: { select: { title: true, sourceType: true, sourceQuality: true } },
        },
        orderBy: { pubDate: 'desc' },
        take: limit,
      });
      diagnostics.levelsAttempted.push({
        level: 'national', feedsFound: nationalFeeds.length,
        itemsFound: nationalItems.length, lookbackDays: SCOUT_LOCAL_NEWS_LOOKBACK_DAYS,
      });
      const mappedNational = nationalItems.map(raw => ({
        id: raw.id, title: raw.title ?? '', description: raw.description ?? '',
        link: raw.link ?? '', pubDate: raw.pubDate?.toISOString() ?? '',
        imageUrl: raw.imageUrl ?? null, author: raw.author ?? null,
        categories: raw.categories, feedId: raw.feedId,
        feedTitle: raw.feed.title ?? '', feedSourceType: raw.feed.sourceType,
        feedSourceQuality: raw.feed.sourceQuality,
        geoConfidence: 0.3, coverageType: 'inferred' as const,
        relevanceScore: raw.relevanceScore,
      }));
      addItems(mappedNational, 'national');
    }
    if (diagnostics.fallbackLevel === 'none' && allItems.length > 0) {
      diagnostics.fallbackLevel = 'national';
    }
  }

  // Trigger async discovery if still thin
  if (allItems.length < SCOUT_MIN_LOCAL_ITEMS && process.env.SCOUT_FEED_DISCOVERY_ENABLED !== 'false') {
    diagnostics.discoveryTriggered = true;
    diagnostics.discoveryReason =
      `Only ${allItems.length} items after all geo levels (min=${SCOUT_MIN_LOCAL_ITEMS}). ` +
      `ZIP=${centerZip} City=${resolvedCity} County=${resolvedCounty} State=${resolvedState}`;
    console.warn(`[trade-area-feed] DISCOVERY_NEEDED: ${diagnostics.discoveryReason}`);
    // Fire-and-forget: discover, validate, save feeds WITH FeedGeo links
    discoverValidateAndLink({
      zip: centerZip, city: resolvedCity, county: resolvedCounty, state: resolvedState,
    }).then(dr => {
      diagnostics.discoveryResult = {
        feedsDiscovered: dr.feedsDiscovered,
        feedsSaved: dr.feedsSaved,
        feedGeoLinksCreated: dr.feedGeoLinksCreated,
        feedsSkippedInvalid: dr.feedsSkippedInvalid,
      };
      console.log(`[trade-area-feed] Discovery complete: ${dr.feedsSaved} saved, ${dr.feedGeoLinksCreated} geo links`);
    }).catch(err => {
      console.error('[trade-area-feed] Async discovery error:', err);
    });
  }

  if (diagnostics.fallbackLevel === 'none') {
    diagnostics.fallbackLevel = allItems.length > 0 ? 'national' : 'none_empty';
  }

  // ── Rank all collected items ────────────────────────────────────────────
  const GEO_LEVEL_SCORE: Record<string, number> = { zip: 10, city: 7, county: 4, state: 2, national: 1 };

  const scored = allItems.map(item => {
    const qualityScore = QUALITY_SCORES[item.feedSourceQuality] ?? 20;
    const typePriority = SOURCE_TYPE_PRIORITY[item.feedSourceType] ?? 2;
    const hoursOld = item.pubDate
      ? (Date.now() - new Date(item.pubDate).getTime()) / (1000 * 60 * 60)
      : 999;
    const freshnessScore = Math.max(0, 100 - hoursOld * 0.6);
    const geoLevelBonus = (GEO_LEVEL_SCORE[item.localityLevel] ?? 1) * 3;

    const compositeScore =
      freshnessScore * 0.30 +
      qualityScore * 0.20 +
      typePriority * 3 +
      item.geoConfidence * 10 +
      geoLevelBonus +
      (item.relevanceScore ?? 50) * 0.05;

    return { item, compositeScore };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // Diversity: max 3 from same feed, title dedup, cap at SCOUT_MAX_LOCAL_ITEMS
  const feedCounts = new Map<string, number>();
  const titlesSeen = new Set<string>();
  const diverse: typeof scored = [];
  for (const s of scored) {
    const count = feedCounts.get(s.item.feedId) ?? 0;
    if (count >= 3) continue;
    const titleKey = (s.item.title || '').toLowerCase().slice(0, 60);
    if (titleKey.length > 10 && titlesSeen.has(titleKey)) continue;
    if (titleKey.length > 10) titlesSeen.add(titleKey);
    feedCounts.set(s.item.feedId, count + 1);
    diverse.push(s);
    if (diverse.length >= SCOUT_MAX_LOCAL_ITEMS) break;
  }

  // ── Build brief ────────────────────────────────────────────────────────
  const finalItems = diverse.map(s => s.item);

  const catCounts = new Map<string, number>();
  for (const item of finalItems) {
    catCounts.set(item.feedSourceType, (catCounts.get(item.feedSourceType) ?? 0) + 1);
  }
  const topCategories = Array.from(catCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const patterns: ContentBrief['patterns'] = [];
  const weatherItems = finalItems.filter(i => i.feedSourceType === 'weather');
  if (weatherItems.length > 0) patterns.push({ type: 'weather', description: `${weatherItems.length} weather update(s)`, itemIds: weatherItems.map(i => i.id) });
  const govItems = finalItems.filter(i => i.feedSourceType === 'gov_meeting');
  if (govItems.length > 0) patterns.push({ type: 'gov_meeting', description: `${govItems.length} government meeting/update(s)`, itemIds: govItems.map(i => i.id) });
  const communityItems = finalItems.filter(i => i.feedSourceType === 'community' || i.feedSourceType === 'event');
  if (communityItems.length > 0) patterns.push({ type: 'community_events', description: `${communityItems.length} community/event item(s)`, itemIds: communityItems.map(i => i.id) });
  const trending = finalItems.filter(i => i.feedSourceType === 'local_news' && i.geoConfidence >= 0.7).slice(0, 5);
  if (trending.length > 0) patterns.push({ type: 'trending_local', description: `${trending.length} trending local news item(s)`, itemIds: trending.map(i => i.id) });

  // Locality level breakdown
  const levelCounts: Record<string, number> = {};
  for (const item of finalItems) {
    levelCounts[item.localityLevel] = (levelCounts[item.localityLevel] ?? 0) + 1;
  }
  if (Object.keys(levelCounts).length > 0) {
    const desc = Object.entries(levelCounts).map(([l, c]) => `${l}:${c}`).join(', ');
    patterns.push({ type: 'locality_breakdown', description: desc, itemIds: [] });
  }

  diagnostics.totalFeedsChecked = diagnostics.levelsAttempted.reduce((sum, l) => sum + l.feedsFound, 0);
  diagnostics.totalItemsFetched = diagnostics.levelsAttempted.reduce((sum, l) => sum + l.itemsFound, 0);
  diagnostics.finalItemCount = finalItems.length;
  diagnostics.queryTimeMs = Date.now() - start;
  diagnostics.requestedLocation = { zip: centerZip, city: resolvedCity, county: resolvedCounty, state: resolvedState };

  // Rejection reasons summary
  const rejections: Record<string, number> = {};
  if (diagnostics.deduplicatedItems > 0) rejections['duplicate_title_or_id'] = diagnostics.deduplicatedItems;
  const overCap = diverse.length < scored.length ? scored.length - diverse.length : 0;
  if (overCap > 0) rejections['diversity_cap_or_title_dedup'] = overCap;
  diagnostics.rejectedItems = Object.entries(rejections).map(([reason, count]) => ({ reason, count }));

  const uniqueFeeds = new Set(finalItems.map(i => i.feedId));

  console.log(
    `[trade-area-feed] Brief: ${finalItems.length} items from ${uniqueFeeds.size} feeds ` +
    `| fallback=${diagnostics.fallbackLevel} ` +
    `| levels=${diagnostics.levelsAttempted.map(l => `${l.level}(${l.itemsFound})`).join('→')} ` +
    `| ${Date.now() - start}ms`
  );

  return {
    generatedAt: new Date().toISOString(),
    tradeAreaCenter: centerZip,
    radiusMiles,
    summary: { totalItems: finalItems.length, feedsMatched: uniqueFeeds.size, topCategories },
    headlines: finalItems.slice(0, SCOUT_MAX_LOCAL_ITEMS).map(i => ({
      id: i.id, title: i.title, source: i.feedTitle, sourceType: i.feedSourceType,
      pubDate: i.pubDate, link: i.link, geoConfidence: i.geoConfidence,
      localityLevel: i.localityLevel,
    })),
    patterns,
    diagnostics,
  };
}

// Old triggerAsyncDiscovery removed — replaced by discoverValidateAndLink in geo-linker.ts