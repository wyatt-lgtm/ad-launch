/**
 * RSS Content Database Client
 *
 * In production, the ad-launch-frontend connects to ad_launch_DB for auth,
 * sessions, businesses, and user data. However, the RSS content pipeline
 * (RssFeed rows, RssItem rows) is populated by Tombstone workers that
 * write to tombstone_db.
 *
 * This module provides a Prisma client that connects to whichever database
 * holds the RSS content:
 *   - If TOMBSTONE_DATABASE_URL is set → uses that (production: tombstone_db)
 *   - Otherwise → falls back to DATABASE_URL (dev or shared-DB setups)
 *
 * IMPORTANT: Only use this client for READ queries against RssFeed / RssItem
 * tables. All auth, user, business, and preference writes must use the
 * default `prisma` client from '@/lib/db'.
 */
import { PrismaClient } from '@prisma/client';

const globalForRss = globalThis as unknown as {
  rssPrisma: PrismaClient | undefined;
};

/** Extract DB name from a postgres URL for safe logging (no credentials) */
function dbNameFromUrl(url: string | undefined): string {
  if (!url) return '(unknown)';
  try {
    const match = url.match(/\/\/[^/]+\/([^?]+)/);
    return match?.[1] ?? '(parse-error)';
  } catch {
    return '(parse-error)';
  }
}

function createRssPrismaClient(): PrismaClient {
  const tombstoneUrl = process.env.TOMBSTONE_DATABASE_URL;
  if (tombstoneUrl) {
    const dbName = dbNameFromUrl(tombstoneUrl);
    console.log(`[rss-db] Using TOMBSTONE_DATABASE_URL for RSS content queries (db: ${dbName})`);
    return new PrismaClient({
      datasources: {
        db: { url: tombstoneUrl },
      },
    });
  }
  // Fallback: same DB as the app (dev environments, shared DB)
  const dbName = dbNameFromUrl(process.env.DATABASE_URL);
  console.log(`[rss-db] TOMBSTONE_DATABASE_URL not set — using default DATABASE_URL (db: ${dbName})`);
  return new PrismaClient();
}

export const rssPrisma = globalForRss.rssPrisma ?? createRssPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForRss.rssPrisma = rssPrisma;
