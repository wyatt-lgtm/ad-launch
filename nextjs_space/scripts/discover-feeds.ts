/**
 * Phase 3: Feed Discovery CLI
 *
 * Discovers RSS feeds from curated seed sources for pilot states,
 * classifies them, and stores as pending in the RssFeed table.
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/discover-feeds.ts           # all pilot states
 *   cd nextjs_space && npx tsx scripts/discover-feeds.ts CO TX     # specific states
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { discoverFeedsFromSite, canonicalizeFeedUrl, type DiscoveredFeed } from '../lib/rss/discovery';
import { classifySource } from '../lib/rss/source-classifier';

const prisma = new PrismaClient();

interface SeedSource {
  url: string;
  note: string;
}

interface SeedState {
  label: string;
  sources: SeedSource[];
}

async function main() {
  // Parse CLI args
  const requestedStates = process.argv.slice(2).map(s => s.toUpperCase());

  // Load seed sources
  const seedPath = path.resolve(__dirname, '../data/pilot-seed-sources.json');
  if (!fs.existsSync(seedPath)) {
    console.error('\u274c Seed sources not found at', seedPath);
    process.exit(1);
  }
  const seedData: Record<string, SeedState> = JSON.parse(
    fs.readFileSync(seedPath, 'utf-8')
  );
  delete (seedData as any)._comment;

  // Filter to requested states or all
  const stateCodes = requestedStates.length > 0
    ? requestedStates.filter(s => seedData[s])
    : Object.keys(seedData);

  if (stateCodes.length === 0) {
    console.error('\u274c No valid states found. Available:', Object.keys(seedData).join(', '));
    process.exit(1);
  }

  console.log(`\n\u2550\u2550\u2550 RSS Feed Discovery \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  console.log(`States: ${stateCodes.join(', ')}`);
  console.log();

  let totalDiscovered = 0;
  let totalStored = 0;
  let totalDupes = 0;

  for (const stateCode of stateCodes) {
    const state = seedData[stateCode];
    console.log(`\n\ud83d\uddfa\ufe0f  ${state.label} (${stateCode}) \u2014 ${state.sources.length} seed sources`);
    console.log('\u2500'.repeat(50));

    const stateFeeds: DiscoveredFeed[] = [];

    for (let i = 0; i < state.sources.length; i++) {
      const src = state.sources[i];
      process.stdout.write(`  [${i + 1}/${state.sources.length}] ${src.note} ... `);

      try {
        const feeds = await discoverFeedsFromSite(src.url);
        if (feeds.length > 0) {
          console.log(`\u2705 ${feeds.length} feed(s)`);
          // Tag each feed with the source URL
          for (const f of feeds) {
            if (!f.siteUrl) f.siteUrl = src.url;
          }
          stateFeeds.push(...feeds);
        } else {
          console.log('\u2014 no feeds found');
        }
      } catch (err: any) {
        console.log(`\u274c error: ${err?.message?.slice(0, 60)}`);
      }
    }

    // Deduplicate within state
    const seen = new Set<string>();
    const uniqueFeeds = stateFeeds.filter(f => {
      const c = canonicalizeFeedUrl(f.url);
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });

    console.log(`\n  Discovered: ${stateFeeds.length} total, ${uniqueFeeds.length} unique`);
    totalDiscovered += uniqueFeeds.length;

    // Classify and store
    for (const feed of uniqueFeeds) {
      const classification = classifySource(feed.url, feed.siteUrl, feed.title, feed.description);

      // Check if already in DB
      const existing = await prisma.rssFeed.findUnique({
        where: { url: canonicalizeFeedUrl(feed.url) },
      });

      if (existing) {
        totalDupes++;
        continue;
      }

      try {
        const safeTitle = typeof feed.title === 'string' ? feed.title.slice(0, 500) : null;
        const safeDesc = typeof feed.description === 'string' ? feed.description.slice(0, 2000) : null;
        await prisma.rssFeed.create({
          data: {
            url: canonicalizeFeedUrl(feed.url),
            title: safeTitle,
            description: safeDesc,
            siteUrl: feed.siteUrl,
            language: feed.language || 'en',
            sourceType: classification.sourceType,
            sourceQuality: classification.sourceQuality,
            status: 'pending',
            discoveryMethod: feed.discoveryMethod,
            feedFormat: feed.feedFormat,
            pilotState: stateCode,
          },
        });
        totalStored++;
      } catch (err: any) {
        // Likely unique constraint race
        if (err?.code === 'P2002') {
          totalDupes++;
        } else {
          console.error(`    \u274c Failed to store ${feed.url}: ${err?.message?.slice(0, 80)}`);
        }
      }
    }

    console.log(`  Stored: ${totalStored} new feeds (${totalDupes} duplicates skipped)`);
  }

  // Final summary
  const dbCount = await prisma.rssFeed.count();
  const byState = await prisma.rssFeed.groupBy({
    by: ['pilotState'],
    _count: true,
  });
  const byType = await prisma.rssFeed.groupBy({
    by: ['sourceType'],
    _count: true,
    orderBy: { _count: { sourceType: 'desc' } },
  });
  const byQuality = await prisma.rssFeed.groupBy({
    by: ['sourceQuality'],
    _count: true,
  });

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  Discovery Complete');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(`  Total in DB:     ${dbCount}`);
  console.log(`  New this run:    ${totalStored}`);
  console.log(`  Dupes skipped:   ${totalDupes}`);
  console.log();
  console.log('  By State:');
  for (const s of byState) {
    console.log(`    ${s.pilotState || 'null'}: ${s._count}`);
  }
  console.log();
  console.log('  By Source Type:');
  for (const t of byType) {
    console.log(`    ${t.sourceType}: ${t._count}`);
  }
  console.log();
  console.log('  By Quality:');
  for (const q of byQuality) {
    console.log(`    ${q.sourceQuality}: ${q._count}`);
  }
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
}

main()
  .catch((e) => {
    console.error('\u274c Discovery failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
