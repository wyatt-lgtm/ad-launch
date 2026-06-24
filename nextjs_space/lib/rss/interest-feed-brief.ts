// @ts-nocheck
/**
 * Interest Feed Brief Generator
 *
 * Queries national/interest-category RSS feeds based on a business's
 * BusinessFeedPreference selections. Returns a structured brief for
 * the Tombstone creative pipeline.
 *
 * Used when contentSourceMode is:
 *   - "local_plus_interests" → merged with local trade-area brief
 *   - "interests_only"      → sole content source
 */
import { prisma } from '@/lib/db';
import { rssPrisma } from '@/lib/rss-db';

export interface InterestFeedBrief {
  generatedAt: string;
  businessId: string;
  categories: {
    industry: string;
    label: string;
    itemCount: number;
    headlines: {
      id: string;
      title: string;
      source: string;
      pubDate: string;
      link: string;
    }[];
  }[];
  summary: {
    totalItems: number;
    totalCategories: number;
    feedsMatched: number;
  };
}

// Human-readable labels for industry keys
const INDUSTRY_LABELS: Record<string, string> = {
  technology: 'Technology & Innovation',
  small_business: 'Small Business Tips',
  automotive: 'Automotive',
  sports: 'Sports',
  rural_agriculture: 'Rural & Agriculture',
  rodeo_western: 'Rodeo & Western',
  home_services: 'Home Services',
  cybersecurity: 'Cybersecurity',
  retail_consumer: 'Retail & Consumer',
  weather: 'Weather & Climate',
};

/**
 * Generate an interest-feed brief for a given business.
 *
 * @param businessId  The business ID to load preferences for
 * @param options     Optional overrides for days lookback and item limits
 */
export async function generateInterestFeedBrief(
  businessId: string,
  options: { days?: number; maxItemsPerCategory?: number; maxTotalItems?: number } = {},
): Promise<InterestFeedBrief> {
  const { days = 5, maxItemsPerCategory = 6, maxTotalItems = 24 } = options;
  const start = Date.now();

  // 1. Load enabled BusinessFeedPreference entries
  const prefs = await prisma.businessFeedPreference.findMany({
    where: { businessId, enabled: true },
    select: { industry: true },
  });

  const enabledIndustries = prefs.map(p => p.industry);

  if (enabledIndustries.length === 0) {
    console.log(`[InterestFeedBrief] No enabled categories for business ${businessId}`);
    return {
      generatedAt: new Date().toISOString(),
      businessId,
      categories: [],
      summary: { totalItems: 0, totalCategories: 0, feedsMatched: 0 },
    };
  }

  // 2. Query national-scope feeds with matching industry, that are active
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  console.log(`[InterestFeedBrief] Querying feeds: industries=[${enabledIndustries.join(',')}], cutoff=${cutoffDate.toISOString()}, maxPerFeed=${maxItemsPerCategory}`);

  // Use rssPrisma for RSS content queries — in production, RssItem rows
  // live in tombstone_db while BusinessFeedPreference lives in ad_launch_DB.
  const feeds = await rssPrisma.rssFeed.findMany({
    where: {
      geoScope: 'national',
      status: 'active',
      industry: { in: enabledIndustries },
    },
    select: {
      id: true,
      title: true,
      industry: true,
      items: {
        where: {
          filterStatus: 'approved',
          pubDate: { gte: cutoffDate },
        },
        select: {
          id: true,
          title: true,
          link: true,
          pubDate: true,
        },
        orderBy: { pubDate: 'desc' },
        take: maxItemsPerCategory, // limit per feed
      },
    },
  });

  console.log(`[InterestFeedBrief] Found ${feeds.length} feeds, total items: ${feeds.reduce((s, f) => s + f.items.length, 0)}`);

  // 3. Group items by industry
  const industryMap = new Map<string, {
    items: { id: string; title: string; source: string; pubDate: string; link: string }[];
    feedCount: number;
  }>();

  for (const feed of feeds) {
    const ind = feed.industry || 'unknown';
    if (!industryMap.has(ind)) {
      industryMap.set(ind, { items: [], feedCount: 0 });
    }
    const bucket = industryMap.get(ind)!;
    bucket.feedCount++;
    for (const item of feed.items) {
      bucket.items.push({
        id: item.id,
        title: item.title || '(untitled)',
        source: feed.title || 'Unknown Source',
        pubDate: item.pubDate?.toISOString() || '',
        link: item.link || '',
      });
    }
  }

  // 4. Build categories array, respecting per-category and total limits
  let totalItemsCollected = 0;
  const categories: InterestFeedBrief['categories'] = [];

  for (const industry of enabledIndustries) {
    const bucket = industryMap.get(industry);
    if (!bucket || bucket.items.length === 0) continue;

    // Sort by date, take top N
    const sorted = bucket.items
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, maxItemsPerCategory);

    const remaining = maxTotalItems - totalItemsCollected;
    if (remaining <= 0) break;
    const headlines = sorted.slice(0, remaining);
    totalItemsCollected += headlines.length;

    categories.push({
      industry,
      label: INDUSTRY_LABELS[industry] || industry,
      itemCount: headlines.length,
      headlines,
    });
  }

  const totalFeeds = new Set(feeds.map(f => f.id)).size;

  console.log(
    `[InterestFeedBrief] business=${businessId} | ` +
    `categories=${categories.length}/${enabledIndustries.length} | ` +
    `items=${totalItemsCollected} | feeds=${totalFeeds} | ` +
    `${Date.now() - start}ms`
  );

  return {
    generatedAt: new Date().toISOString(),
    businessId,
    categories,
    summary: {
      totalItems: totalItemsCollected,
      totalCategories: categories.length,
      feedsMatched: totalFeeds,
    },
  };
}

/**
 * Build a human-readable text block from an InterestFeedBrief
 * for embedding in the Tombstone command.
 */
export function formatInterestBriefForCommand(brief: InterestFeedBrief): string {
  if (brief.categories.length === 0) {
    return 'INTEREST FEEDS: No interest-category items available.';
  }

  const lines: string[] = [];
  lines.push(`INTEREST/NATIONAL FEEDS (${brief.summary.totalItems} items from ${brief.summary.feedsMatched} feeds, ${brief.summary.totalCategories} categories):`);
  lines.push('');

  for (const cat of brief.categories) {
    lines.push(`  ${cat.label} (${cat.itemCount} items):`);
    for (const h of cat.headlines) {
      lines.push(`    • "${h.title}" — ${h.source} (${h.pubDate?.split('T')[0] || 'recent'})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
