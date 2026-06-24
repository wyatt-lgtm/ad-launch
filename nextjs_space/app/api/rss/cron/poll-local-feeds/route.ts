// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ingestFeeds, disableFailedFeeds } from '@/lib/rss/geo-linker';
import { rssPrisma } from '@/lib/rss-db';

/**
 * POST /api/rss/cron/poll-local-feeds
 *
 * Recurring local-feed polling worker. Designed to be called every 4–6 hours
 * by Render cron, an external scheduler, or manually via the admin API.
 *
 * Scope:
 *   • Polls existing ACTIVE local/state/city feeds only (not national).
 *   • Batches feeds to avoid long-running jobs.
 *   • Deduplication by feedId + guid (Prisma unique constraint) + cross-feed
 *     content-hash near-duplicate detection.
 *   • Updates lastFetchedAt / consecutiveErrors on every feed.
 *   • Disables feeds after repeated failures (configurable threshold).
 *   • Does NOT discover new feeds or expand national coverage.
 *
 * Auth: requires CRON_SECRET or ADMIN_API_KEY header.
 */

const BATCH_SIZE = parseInt(process.env.RSS_CRON_BATCH_SIZE || '200', 10);
const CONCURRENCY = parseInt(process.env.RSS_CRON_CONCURRENCY || '5', 10);
const FAILURE_THRESHOLD = parseInt(process.env.SCOUT_FEED_FAILURE_DISABLE_THRESHOLD || '5', 10);

function authCheck(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const adminKey = process.env.ADMIN_API_KEY;

  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '');
  const apiKeyHeader = req.headers.get('x-api-key');
  const cronHeader = req.headers.get('x-cron-secret');

  if (cronSecret && (cronHeader === cronSecret || authHeader === cronSecret || apiKeyHeader === cronSecret)) return true;
  if (adminKey && (apiKeyHeader === adminKey || authHeader === adminKey)) return true;

  return false;
}

export async function POST(req: NextRequest) {
  const runStart = Date.now();

  if (!authCheck(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Determine scope from optional body params
    let body: any = {};
    try { body = await req.json(); } catch { /* no body = poll all */ }

    const targetState = body.state as string | undefined;
    const targetCity = body.city as string | undefined;
    const targetCounty = body.county as string | undefined;
    const batchSize = Math.min(body.limit ?? BATCH_SIZE, 500);
    const concurrency = Math.min(body.concurrency ?? CONCURRENCY, 10);

    console.log(
      `[cron/poll-local-feeds] Starting local feed poll` +
      (targetState ? ` state=${targetState}` : '') +
      (targetCounty ? ` county=${targetCounty}` : '') +
      (targetCity ? ` city=${targetCity}` : '') +
      ` batch=${batchSize} concurrency=${concurrency}`
    );

    // ── Step 1: Ingest active local feeds ──────────────────────────
    // Only poll feeds with geoScope in ['local', 'state', 'city'] — not 'national'.
    // National feeds are polled by poll_national_feeds.py in Tombstone.
    const localFeedIds = await getLocalFeedIds(targetState, targetCity, targetCounty);

    let ingestResult: any = null;
    if (localFeedIds.length > 0) {
      ingestResult = await ingestFeeds({
        feedIds: localFeedIds.slice(0, batchSize),
        concurrency,
      });
    }

    // ── Step 2: Disable feeds with excessive failures ─────────────
    const disableResult = await disableFailedFeeds({
      dryRun: false,
      threshold: FAILURE_THRESHOLD,
    });

    // ── Step 3: Compute health snapshot ───────────────────────────
    const healthSnapshot = await getCronHealthSnapshot();

    const runMs = Date.now() - runStart;

    console.log(
      `[cron/poll-local-feeds] Complete: ` +
      `${ingestResult?.feedsSucceeded ?? 0}/${ingestResult?.feedsProcessed ?? 0} feeds, ` +
      `+${ingestResult?.itemsInserted ?? 0} new items, ` +
      `${disableResult.feedsDisabled} feeds disabled, ` +
      `${runMs}ms`
    );

    return NextResponse.json({
      ok: true,
      runMs,
      ingest: ingestResult ? {
        feedsProcessed: ingestResult.feedsProcessed,
        feedsSucceeded: ingestResult.feedsSucceeded,
        feedsFailed: ingestResult.feedsFailed,
        itemsInserted: ingestResult.itemsInserted,
        itemsUpdated: ingestResult.itemsUpdated,
        itemsDeduplicated: ingestResult.itemsDeduplicated,
        itemsFiltered: ingestResult.itemsFiltered,
      } : { feedsProcessed: 0, feedsSucceeded: 0, feedsFailed: 0, itemsInserted: 0, itemsUpdated: 0, itemsDeduplicated: 0, itemsFiltered: 0 },
      disabled: {
        feedsDisabled: disableResult.feedsDisabled,
        threshold: disableResult.threshold,
      },
      health: healthSnapshot,
    });
  } catch (error: any) {
    console.error('[cron/poll-local-feeds] Fatal error:', error);
    return NextResponse.json(
      { ok: false, error: error.message, runMs: Date.now() - runStart },
      { status: 500 }
    );
  }
}

// Also support GET for simple health probes (returns same health snapshot)
export async function GET(req: NextRequest) {
  if (!authCheck(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const health = await getCronHealthSnapshot();
  return NextResponse.json({ ok: true, health });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Get IDs of active local/state/city feeds, optionally filtered by geo.
 * Excludes national feeds (those are handled by poll_national_feeds.py).
 */
async function getLocalFeedIds(
  state?: string,
  city?: string,
  county?: string,
): Promise<string[]> {
  // If filtering by geo, find feeds via FeedGeo links
  if (state || city || county) {
    const whereClause: any = {
      zip: {
        cityZips: {
          some: {
            city: {
              county: {
                state: state ? { code: state.toUpperCase() } : undefined,
                ...(county ? { name: county.toUpperCase() } : {}),
              },
              ...(city ? { name: city.toUpperCase() } : {}),
            },
          },
        },
      },
    };

    const feedGeos = await rssPrisma.feedGeo.findMany({
      where: whereClause,
      select: { feedId: true },
      distinct: ['feedId'],
    });

    const geoFeedIds = new Set(feedGeos.map(fg => fg.feedId));

    // Also include feeds directly marked as state/city scope for this state
    if (state) {
      const directFeeds = await rssPrisma.rssFeed.findMany({
        where: {
          status: 'active',
          geoScope: { in: ['local', 'state', 'city'] },
          pilotState: state.toUpperCase(),
        },
        select: { id: true },
      });
      directFeeds.forEach(f => geoFeedIds.add(f.id));
    }

    return Array.from(geoFeedIds);
  }

  // No geo filter: return all active local/state/city feeds
  const feeds = await rssPrisma.rssFeed.findMany({
    where: {
      status: 'active',
      geoScope: { in: ['local', 'state', 'city'] },
    },
    select: { id: true },
    orderBy: { lastFetchedAt: 'asc' }, // oldest-polled first
  });

  return feeds.map(f => f.id);
}

/**
 * Compute health metrics for the cron worker.
 */
async function getCronHealthSnapshot() {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    activeLocalFeeds,
    staleFeedCount,
    newestLocalItem,
    feedsByGeoScope,
    recentInsertCount,
  ] = await Promise.all([
    // Active local/state/city feeds
    rssPrisma.rssFeed.count({
      where: { status: 'active', geoScope: { in: ['local', 'state', 'city'] } },
    }),
    // Feeds not polled in 24 hours
    rssPrisma.rssFeed.count({
      where: {
        status: 'active',
        geoScope: { in: ['local', 'state', 'city'] },
        OR: [
          { lastFetchedAt: { lt: twentyFourHoursAgo } },
          { lastFetchedAt: null },
        ],
      },
    }),
    // Newest local item pubDate (exclude nulls)
    rssPrisma.rssItem.findFirst({
      where: {
        feed: { geoScope: { in: ['local', 'state', 'city'] } },
        pubDate: { not: null },
      },
      orderBy: { pubDate: 'desc' },
      select: { pubDate: true, title: true },
    }),
    // Feeds grouped by geoScope
    rssPrisma.rssFeed.groupBy({
      by: ['geoScope'],
      where: { status: 'active' },
      _count: true,
    }),
    // Items fetched in last 6 hours
    rssPrisma.rssItem.count({
      where: { fetchedAt: { gte: sixHoursAgo } },
    }),
  ]);

  return {
    activeLocalFeeds,
    staleFeedCount24h: staleFeedCount,
    newestLocalPubDate: newestLocalItem?.pubDate?.toISOString() ?? null,
    newestLocalTitle: newestLocalItem?.title ?? null,
    recentItemsFetched6h: recentInsertCount,
    feedsByGeoScope: Object.fromEntries(
      feedsByGeoScope.map(g => [g.geoScope, g._count])
    ),
    checkedAt: now.toISOString(),
  };
}
