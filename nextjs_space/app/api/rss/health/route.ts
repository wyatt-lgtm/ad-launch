// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { rssPrisma } from '@/lib/rss-db';

/* ─── helpers ──────────────────────────────────────────────────────── */

function sanitiseError(err: unknown): {
  errorName: string;
  errorCode: string | null;
  errorMessage: string;
} {
  if (!err || typeof err !== 'object') {
    return { errorName: 'UnknownError', errorCode: null, errorMessage: String(err) };
  }
  const e = err as any;
  const name: string = e.constructor?.name ?? e.name ?? 'Error';
  const code: string | null = e.code ?? e.errorCode ?? null;
  let msg: string = e.message ?? String(e);
  msg = msg.replace(/postgresql:\/\/[^\s]+/gi, '<redacted-url>');
  msg = msg.replace(/\d{1,3}(\.\d{1,3}){3}:\d+/g, '<redacted-host>');
  return { errorName: name, errorCode: code, errorMessage: msg };
}

async function currentDatabase(client: any): Promise<string | null> {
  try {
    const rows: any[] = await client.$queryRawUnsafe('SELECT current_database() AS db');
    return rows?.[0]?.db ?? null;
  } catch {
    return null;
  }
}

async function tableExists(client: any, tableName: string): Promise<boolean> {
  try {
    const rows: any[] = await client.$queryRawUnsafe(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS \"exists\"",
      tableName
    );
    return rows?.[0]?.exists === true;
  } catch {
    return false;
  }
}

async function recentApprovedCount(client: any): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  return client.rssItem.count({
    where: { filterStatus: 'approved', pubDate: { gte: cutoff } },
  });
}

/* ─── route ────────────────────────────────────────────────────────── */

export async function GET() {
  const start = Date.now();

  // ── 1. Primary DB (ad_launch_DB) ─────────────────────────────────
  let primaryError: ReturnType<typeof sanitiseError> | null = null;
  let primaryDbName: string | null = null;
  let primaryFeedCount = -1;
  let primaryItemCount = -1;
  let primaryNewest: Date | null = null;

  try {
    [primaryDbName, primaryFeedCount, primaryItemCount, primaryNewest] = await Promise.all([
      currentDatabase(prisma),
      prisma.rssFeed.count(),
      prisma.rssItem.count(),
      prisma.rssItem
        .findFirst({ orderBy: { pubDate: 'desc' }, select: { pubDate: true } })
        .then((r: any) => r?.pubDate ?? null),
    ]);
  } catch (err) {
    primaryError = sanitiseError(err);
  }

  // ── 2. RSS DB (tombstone_db) ─────────────────────────────────────
  let rssError: ReturnType<typeof sanitiseError> | null = null;
  let rssDbName: string | null = null;
  let rssFeedCount = -1;
  let rssItemCount = -1;
  let rssApprovedCount = -1;
  let rssRecentApproved = -1;
  let rssNewest: Date | null = null;
  let hasRssFeedTable = false;
  let hasRssItemTable = false;
  let hasFeedGeoTable = false;

  try {
    // Table existence checks
    [hasRssFeedTable, hasRssItemTable, hasFeedGeoTable] = await Promise.all([
      tableExists(rssPrisma, 'RssFeed'),
      tableExists(rssPrisma, 'RssItem'),
      tableExists(rssPrisma, 'FeedGeo'),
    ]);

    // Data counts (only if tables exist)
    if (hasRssFeedTable && hasRssItemTable) {
      [rssDbName, rssFeedCount, rssItemCount, rssApprovedCount, rssRecentApproved, rssNewest] =
        await Promise.all([
          currentDatabase(rssPrisma),
          rssPrisma.rssFeed.count(),
          rssPrisma.rssItem.count(),
          rssPrisma.rssItem.count({ where: { filterStatus: 'approved' } }),
          recentApprovedCount(rssPrisma),
          rssPrisma.rssItem
            .findFirst({ orderBy: { pubDate: 'desc' }, select: { pubDate: true } })
            .then((r: any) => r?.pubDate ?? null),
        ]);
    } else {
      rssDbName = await currentDatabase(rssPrisma);
    }
  } catch (err) {
    rssError = sanitiseError(err);
  }

  // ── 3. Evaluate health ───────────────────────────────────────────
  const tombstoneConfigured = !!process.env.TOMBSTONE_DATABASE_URL;
  let status: 'healthy' | 'warning' | 'unhealthy' = 'healthy';
  const issues: string[] = [];

  // Schema existence checks
  if (!rssError && (!hasRssFeedTable || !hasRssItemTable || !hasFeedGeoTable)) {
    status = 'unhealthy';
    const missing = [
      !hasRssFeedTable && 'RssFeed',
      !hasRssItemTable && 'RssItem',
      !hasFeedGeoTable && 'FeedGeo',
    ].filter(Boolean);
    issues.push(`rss_schema_missing: tables not found — ${missing.join(', ')}. Run migration 039_restore_rss_intelligence_tables.sql`);
  }

  if (rssError) {
    status = 'unhealthy';
    issues.push(`RSS DB connection failed: ${rssError.errorName} ${rssError.errorCode ?? ''} — ${rssError.errorMessage}`);
    const msg = rssError.errorMessage.toLowerCase();
    const code = (rssError.errorCode ?? '').toLowerCase();
    if (msg.includes('ssl') || msg.includes('sslmode') || code === '08006') {
      issues.push('HINT: Add ?sslmode=require to TOMBSTONE_DATABASE_URL');
    }
    if (msg.includes('password authentication') || msg.includes('auth') || code === '28p01' || code === '28000') {
      issues.push('HINT: Re-copy External Database URL from Render; ensure special characters are URL-encoded');
    }
    if (msg.includes('does not exist') || msg.includes('no such host') || msg.includes('enotfound') || msg.includes('getaddrinfo')) {
      issues.push('HINT: Hostname not resolvable — verify TOMBSTONE_DATABASE_URL and redeploy with clear build cache');
    }
  } else {
    if (rssItemCount === 0 && hasRssItemTable) {
      status = 'unhealthy';
      issues.push('rss_ingestion_needed: RssItem table exists but has 0 rows — run RSS ingestion');
    } else if (rssApprovedCount === 0 && rssItemCount > 0) {
      status = 'warning';
      issues.push('RSS DB has items but 0 approved — content filter may be too strict');
    }
  }

  if (primaryError) {
    if (status === 'healthy') status = 'warning';
    issues.push(`Primary DB connection failed: ${primaryError.errorName}`);
  }

  if (!tombstoneConfigured) {
    issues.push('TOMBSTONE_DATABASE_URL not set — using same DB for auth and RSS content');
    if (primaryItemCount === 0 && !primaryError) {
      status = 'unhealthy';
      issues.push('No RSS items in primary DB and no tombstone DB configured');
    }
  }

  const newestAge = rssNewest
    ? Math.round((Date.now() - new Date(rssNewest).getTime()) / (1000 * 60 * 60))
    : null;
  if (newestAge !== null && newestAge > 48) {
    if (status === 'healthy') status = 'warning';
    issues.push(`Newest RSS item is ${newestAge}h old — ingestion may be stale`);
  }

  // ── 4. Response ──────────────────────────────────────────────────
  return NextResponse.json({
    status,
    issues,
    config: {
      tombstoneConfigured,
      usingDifferentDb: tombstoneConfigured,
      primaryCurrentDatabase: primaryDbName,
      rssCurrentDatabase: rssDbName,
    },
    primaryDb: {
      label: 'ad_launch_DB (auth/businesses)',
      feedCount: primaryFeedCount,
      itemCount: primaryItemCount,
      newestPubDate: primaryNewest?.toISOString?.() ?? null,
      ...(primaryError ? { error: primaryError } : {}),
    },
    rssDb: {
      label: tombstoneConfigured ? 'tombstone_db (RSS content)' : 'same as primary',
      hasRssFeedTable,
      hasRssItemTable,
      hasFeedGeoTable,
      feedCount: rssFeedCount,
      itemCount: rssItemCount,
      approvedItemCount: rssApprovedCount,
      approvedRecentCount7d: rssRecentApproved,
      newestPubDate: rssNewest?.toISOString?.() ?? null,
      newestAgeHours: newestAge,
      ...(rssError ? { error: rssError } : {}),
    },
    queryTimeMs: Date.now() - start,
  });
}
