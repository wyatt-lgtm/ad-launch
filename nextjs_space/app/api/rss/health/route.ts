// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { rssPrisma } from '@/lib/rss-db';

/**
 * GET /api/rss/health
 *
 * Diagnostic endpoint reporting RSS content health across both databases.
 * Shows feed counts, item counts, newest pubDate, and which DB each client
 * points to. Useful for verifying TOMBSTONE_DATABASE_URL is wired correctly.
 */
export async function GET() {
  const start = Date.now();

  try {
    // --- Primary DB (ad_launch_DB): auth, businesses, preferences ---
    const [primaryFeedCount, primaryItemCount, primaryNewest] = await Promise.all([
      prisma.rssFeed.count().catch(() => -1),
      prisma.rssItem.count().catch(() => -1),
      prisma.rssItem.findFirst({ orderBy: { pubDate: 'desc' }, select: { pubDate: true } }).catch(() => null),
    ]);

    // --- RSS DB (tombstone_db when TOMBSTONE_DATABASE_URL is set) ---
    let rssDbError: string | null = null;
    const [rssFeedCount, rssItemCount, rssApprovedCount, rssNewest] = await Promise.all([
      rssPrisma.rssFeed.count().catch((e: any) => { rssDbError = e.message ?? String(e); return -1; }),
      rssPrisma.rssItem.count().catch((e: any) => { rssDbError = rssDbError ?? e.message ?? String(e); return -1; }),
      rssPrisma.rssItem.count({ where: { filterStatus: 'approved' } }).catch(() => -1),
      rssPrisma.rssItem.findFirst({ orderBy: { pubDate: 'desc' }, select: { pubDate: true } }).catch(() => null),
    ]);

    const tombstoneConfigured = !!process.env.TOMBSTONE_DATABASE_URL;
    const usingDifferentDb = tombstoneConfigured;

    // Determine health status
    let status: 'healthy' | 'warning' | 'unhealthy' = 'healthy';
    const issues: string[] = [];

    if (rssItemCount === 0) {
      status = 'unhealthy';
      issues.push('RSS DB has 0 items — content pipeline may not be running');
    } else if (rssApprovedCount === 0) {
      status = 'warning';
      issues.push('RSS DB has items but 0 approved — content filter may be too strict');
    }

    if (!tombstoneConfigured) {
      issues.push('TOMBSTONE_DATABASE_URL not set — using same DB for auth and RSS content');
      if (primaryItemCount === 0) {
        status = 'unhealthy';
        issues.push('No RSS items in primary DB and no tombstone DB configured');
      }
    }

    const newestAge = rssNewest?.pubDate
      ? Math.round((Date.now() - new Date(rssNewest.pubDate).getTime()) / (1000 * 60 * 60))
      : null;
    if (newestAge !== null && newestAge > 48) {
      if (status === 'healthy') status = 'warning';
      issues.push(`Newest RSS item is ${newestAge}h old — ingestion may be stale`);
    }

    return NextResponse.json({
      status,
      issues,
      config: {
        tombstoneConfigured,
        usingDifferentDb,
        ...(rssDbError ? { rssDbConnectionError: rssDbError } : {}),
      },
      primaryDb: {
        label: 'ad_launch_DB (auth/businesses)',
        feedCount: primaryFeedCount,
        itemCount: primaryItemCount,
        newestPubDate: primaryNewest?.pubDate?.toISOString() ?? null,
      },
      rssDb: {
        label: tombstoneConfigured ? 'tombstone_db (RSS content)' : 'same as primary',
        feedCount: rssFeedCount,
        itemCount: rssItemCount,
        approvedItemCount: rssApprovedCount,
        newestPubDate: rssNewest?.pubDate?.toISOString() ?? null,
        newestAgeHours: newestAge,
      },
      queryTimeMs: Date.now() - start,
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
