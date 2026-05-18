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
import { getZipsByRadius, getZipsByCounty, getZipsByCity } from './geo-lookup';
import type { TradeAreaRequest, TradeAreaItem, TradeAreaResponse } from './types';

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
  const feedGeos = await prisma.feedGeo.findMany({
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
  const globalFeeds = await prisma.rssFeed.findMany({
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

  const rawItems = await prisma.rssItem.findMany({
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
  }[];
  patterns: {
    type: string;
    description: string;
    itemIds: string[];
  }[];
}

export async function generateContentBrief(
  centerZip: string,
  radiusMiles: number = 25,
  options: Omit<TradeAreaRequest, 'zips' | 'cities' | 'counties' | 'states'> = {},
): Promise<ContentBrief> {
  const result = await getItemsByRadius(centerZip, radiusMiles, {
    limit: 50,
    days: 3,
    ...options,
  });

  // Tally categories
  const typeCounts = new Map<string, number>();
  for (const item of result.items) {
    const t = item.feedSourceType;
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const topCategories = Array.from(typeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Detect simple patterns
  const patterns: ContentBrief['patterns'] = [];

  // Weather pattern
  const weatherItems = result.items.filter(i => i.feedSourceType === 'weather');
  if (weatherItems.length > 0) {
    patterns.push({
      type: 'weather',
      description: `${weatherItems.length} weather update(s) in the last 3 days`,
      itemIds: weatherItems.map(i => i.id),
    });
  }

  // Gov meeting pattern
  const govItems = result.items.filter(i => i.feedSourceType === 'gov_meeting');
  if (govItems.length > 0) {
    patterns.push({
      type: 'gov_meeting',
      description: `${govItems.length} government meeting/update(s)`,
      itemIds: govItems.map(i => i.id),
    });
  }

  // Community events
  const communityItems = result.items.filter(i =>
    i.feedSourceType === 'community' || i.feedSourceType === 'event'
  );
  if (communityItems.length > 0) {
    patterns.push({
      type: 'community_events',
      description: `${communityItems.length} community/event item(s)`,
      itemIds: communityItems.map(i => i.id),
    });
  }

  // Breaking/trending — recent high-quality items
  const trending = result.items
    .filter(i => i.feedSourceType === 'local_news' && i.geoConfidence >= 0.7)
    .slice(0, 5);
  if (trending.length > 0) {
    patterns.push({
      type: 'trending_local',
      description: `${trending.length} trending local news item(s)`,
      itemIds: trending.map(i => i.id),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    tradeAreaCenter: centerZip,
    radiusMiles,
    summary: {
      totalItems: result.items.length,
      feedsMatched: result.meta.feedsMatched,
      topCategories,
    },
    headlines: result.items.slice(0, 20).map(i => ({
      id: i.id,
      title: i.title,
      source: i.feedTitle,
      sourceType: i.feedSourceType,
      pubDate: i.pubDate,
      link: i.link,
      geoConfidence: i.geoConfidence,
    })),
    patterns,
  };
}
