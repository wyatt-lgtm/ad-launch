// @ts-nocheck
/**
 * Phase 4: Feed Validation Orchestrator
 *
 * Fetches all 'pending' feeds, parses XML, scores them,
 * deduplicates items, and updates the database.
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/validate-feeds.ts              # all pending
 *   cd nextjs_space && npx tsx scripts/validate-feeds.ts --limit 50  # first 50
 *   cd nextjs_space && npx tsx scripts/validate-feeds.ts --retry     # include broken (retry)
 */
import { PrismaClient } from '@prisma/client';
import { fetchAndParseFeed } from '../lib/rss/feed-parser';
import { scoreFeed } from '../lib/rss/freshness-scorer';
import { itemContentHash, isNearDuplicate } from '../lib/rss/dedup';
import { classifyContent } from '../lib/rss/content-policy';
import type { SourceQuality } from '../lib/rss/types';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

const CONCURRENCY = 8;           // parallel feed fetches
const STALE_DAYS = 30;           // feeds with no item newer than this → stale
const MAX_ITEMS_PER_FEED = 50;   // store latest N items max
const DEDUP_THRESHOLD = 3;       // SimHash hamming distance threshold
const RETRY_AFTER_ERRORS = 5;    // skip feeds with this many consecutive errors

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const includeRetry = args.includes('--retry');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

  console.log('\n═══════════════════════════════════════════════');
  console.log(' Phase 4: Feed Validation + Scoring + Dedupe');
  console.log('═══════════════════════════════════════════════\n');

  // Build where clause
  const statusFilter: string[] = ['pending'];
  if (includeRetry) statusFilter.push('broken');

  const feeds = await prisma.rssFeed.findMany({
    where: {
      status: { in: statusFilter },
      ...(includeRetry ? {} : { consecutiveErrors: { lt: RETRY_AFTER_ERRORS } }),
    },
    orderBy: { discoveredAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`Found ${feeds.length} feeds to validate (statuses: ${statusFilter.join(', ')})\n`);

  // Load existing content hashes for cross-feed dedup
  const existingHashes = await loadExistingHashes();

  // Stats
  const stats = {
    processed: 0,
    active: 0,
    stale: 0,
    broken: 0,
    itemsInserted: 0,
    itemsDeduplicated: 0,
    itemsFiltered: 0,
  };

  // Process in batches
  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    const batch = feeds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(feed => validateSingleFeed(feed, existingHashes, stats))
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('  ✗ Batch item failed:', r.reason?.message ?? r.reason);
      }
    }

    stats.processed += batch.length;
    const pct = Math.round((stats.processed / feeds.length) * 100);
    console.log(`  ▸ Progress: ${stats.processed}/${feeds.length} (${pct}%)`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(' Validation Complete');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Processed:       ${stats.processed}`);
  console.log(`  Active:          ${stats.active}`);
  console.log(`  Stale:           ${stats.stale}`);
  console.log(`  Broken:          ${stats.broken}`);
  console.log(`  Items Inserted:  ${stats.itemsInserted}`);
  console.log(`  Items Deduped:   ${stats.itemsDeduplicated}`);
  console.log(`  Items Filtered:  ${stats.itemsFiltered}`);
  console.log('');

  await prisma.$disconnect();
}

// ═══════════════════════════════════════════════════════════════
// Single Feed Validation
// ═══════════════════════════════════════════════════════════════

async function validateSingleFeed(
  feed: any,
  existingHashes: Map<string, string>,
  stats: { active: number; stale: number; broken: number; itemsInserted: number; itemsDeduplicated: number; itemsFiltered: number },
) {
  const { feed: parsed, error, httpStatus, redirectUrl } = await fetchAndParseFeed(feed.url);

  if (!parsed || error) {
    // Mark as broken
    const newErrorCount = (feed.consecutiveErrors ?? 0) + 1;
    await prisma.rssFeed.update({
      where: { id: feed.id },
      data: {
        status: 'broken',
        fetchErrorCount: { increment: 1 },
        consecutiveErrors: newErrorCount,
        lastFetchedAt: new Date(),
      },
    });
    // Audit
    await prisma.feedAudit.create({
      data: {
        feedId: feed.id,
        action: 'status_change',
        oldValue: feed.status,
        newValue: 'broken',
        reason: `Fetch error: ${error} (HTTP ${httpStatus ?? 'N/A'})`,
        performedBy: 'system:phase4_validation',
      },
    });
    stats.broken++;
    console.log(`  ✗ BROKEN  ${feed.url}  →  ${error}`);
    return;
  }

  // Check if feed has geo coverage
  const geoCount = await prisma.feedGeo.count({ where: { feedId: feed.id } });
  const hasGeo = geoCount > 0;

  // Score
  const scores = scoreFeed(
    parsed,
    feed.sourceQuality as SourceQuality,
    hasGeo,
  );

  // Determine status
  const isStale = scores.lastItemDate
    ? (Date.now() - scores.lastItemDate.getTime()) > (STALE_DAYS * 24 * 60 * 60 * 1000)
    : true; // no dated items = stale
  const newStatus = isStale ? 'stale' : 'active';

  // Update feed record
  await prisma.rssFeed.update({
    where: { id: feed.id },
    data: {
      status: newStatus,
      title: parsed.meta.title ?? feed.title,
      description: parsed.meta.description ?? feed.description,
      siteUrl: parsed.meta.siteUrl ?? feed.siteUrl,
      language: parsed.meta.language ?? feed.language,
      feedFormat: parsed.meta.format,
      canonicalUrl: redirectUrl ?? feed.canonicalUrl,
      freshnessScore: scores.freshnessScore,
      qualityScore: scores.qualityScore,
      avgItemsPerWeek: scores.avgItemsPerWeek,
      lastItemDate: scores.lastItemDate,
      lastFetchedAt: new Date(),
      consecutiveErrors: 0,  // reset on success
    },
  });

  if (newStatus !== feed.status) {
    await prisma.feedAudit.create({
      data: {
        feedId: feed.id,
        action: 'status_change',
        oldValue: feed.status,
        newValue: newStatus,
        reason: `Freshness=${scores.freshnessScore}, Quality=${scores.qualityScore}, Items=${scores.itemCount}`,
        performedBy: 'system:phase4_validation',
      },
    });
  }

  // ── Insert items ──────────────────────────────────────────
  const latestItems = parsed.items.slice(0, MAX_ITEMS_PER_FEED);
  let inserted = 0;
  let deduped = 0;
  let filtered = 0;

  for (const item of latestItems) {
    if (!item.guid) continue;

    // Compute content hash
    const hash = itemContentHash(item.title, item.description);

    // Cross-feed dedup check
    let isDuplicate = false;
    if (hash !== '0000000000000000') {
      for (const [existingHash, existingFeedId] of existingHashes) {
        if (existingFeedId !== feed.id && isNearDuplicate(hash, existingHash, DEDUP_THRESHOLD)) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (isDuplicate) {
      deduped++;
      continue;
    }

    // Content policy check (fast keyword layer only)
    const filterDecision = classifyContent(
      item.title ?? '',
      item.description ?? '',
    );

    // Upsert item
    try {
      await prisma.rssItem.upsert({
        where: {
          feedId_guid: {
            feedId: feed.id,
            guid: item.guid,
          },
        },
        create: {
          feedId: feed.id,
          guid: item.guid,
          title: item.title,
          description: item.description,
          link: item.link,
          pubDate: item.pubDate,
          author: item.author,
          imageUrl: item.imageUrl,
          categories: item.categories,
          contentHash: hash,
          filterStatus: filterDecision.status,
          filterReason: filterDecision.reason,
          blockedCategory: filterDecision.category,
        },
        update: {
          title: item.title,
          description: item.description,
          link: item.link,
          pubDate: item.pubDate,
          author: item.author,
          imageUrl: item.imageUrl,
          categories: item.categories,
          contentHash: hash,
          // Don't overwrite filter status if already manually reviewed
        },
      });
      inserted++;

      // Track hash for ongoing dedup
      if (hash !== '0000000000000000') {
        existingHashes.set(hash, feed.id);
      }

      if (filterDecision.status === 'blocked') filtered++;
    } catch (err: any) {
      // Likely a unique constraint violation — skip silently
      if (!err?.message?.includes('Unique constraint')) {
        console.error(`  ⚠ Item insert error for ${item.guid}:`, err?.message);
      }
    }
  }

  stats.itemsInserted += inserted;
  stats.itemsDeduplicated += deduped;
  stats.itemsFiltered += filtered;

  if (newStatus === 'active') stats.active++;
  else stats.stale++;

  const emoji = newStatus === 'active' ? '✓' : '⏳';
  console.log(`  ${emoji} ${newStatus.toUpperCase().padEnd(6)} ${feed.url}  F=${scores.freshnessScore} Q=${scores.qualityScore} items=${inserted}/${latestItems.length} dedup=${deduped}`);
}

// ═══════════════════════════════════════════════════════════════
// Helper: Load existing content hashes
// ═══════════════════════════════════════════════════════════════

async function loadExistingHashes(): Promise<Map<string, string>> {
  const rows = await prisma.rssItem.findMany({
    where: {
      contentHash: { not: null },
    },
    select: {
      contentHash: true,
      feedId: true,
    },
  });

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.contentHash) map.set(row.contentHash, row.feedId);
  }
  console.log(`Loaded ${map.size} existing content hashes for cross-feed dedup\n`);
  return map;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
